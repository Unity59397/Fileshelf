import crypto from 'node:crypto';
import { tx } from './db.js';
import { httpError } from './http.js';

// ---- Money -------------------------------------------------------------------------------------
// All amounts are whole pence. The platform fee is rounded down, so the seller never gets less than their share.
export function splitAmount(cfg, amountPence) {
  const fee = Math.floor((amountPence * cfg.feeBps) / 10000);
  return { fee, net: amountPence - fee };
}

// Marks an order paid. Safe to call twice: the second call does nothing.
export function markOrderPaid(db, orderId, providerRef) {
  return tx(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return null;
    if (order.status === 'paid') return order;
    if (order.status !== 'pending') return null;
    const already = db
      .prepare("SELECT id FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'")
      .get(order.buyer_id, order.listing_id);
    if (already) {
      // The buyer paid twice for the same listing. Keep the first order. This one needs a refund.
      db.prepare("UPDATE orders SET status = 'failed', provider_ref = COALESCE(?, provider_ref) WHERE id = ?").run(
        providerRef || null,
        orderId,
      );
      console.warn(`Order ${orderId} was a duplicate payment and needs a refund.`);
      return null;
    }
    db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ?").run(
      Date.now(),
      providerRef || null,
      orderId,
    );
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });
}

// ---- Stripe over plain HTTPS (no SDK needed) ---------------------------------------------------
const STRIPE_API = 'https://api.stripe.com/v1';

// Stripe wants nested form fields like line_items[0][quantity]=1.
export function encodeForm(obj) {
  const pairs = [];
  const walk = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    } else pairs.push([key, String(value)]);
  };
  walk(obj, '');
  return new URLSearchParams(pairs).toString();
}

async function stripe(cfg, method, path, params) {
  const res = await fetch(STRIPE_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? encodeForm(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe error:', data.error?.message || res.status);
    throw httpError(502, 'The payment provider returned an error. Try again in a moment.');
  }
  return data;
}

// Checks the Stripe-Signature header against the raw request body.
export function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  // Stripe may send several v1 signatures while a secret is being rotated.
  const signatures = header
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  return signatures.some((sig) => {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export function handleStripeEvent(db, event) {
  const seen = db.prepare('SELECT id FROM webhook_events WHERE id = ?').get(event.id);
  if (seen) return 'duplicate';
  db.prepare('INSERT INTO webhook_events (id, received_at) VALUES (?,?)').run(event.id, Date.now());
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const orderId = obj.client_reference_id || obj.metadata?.order_id;
      if (orderId && obj.payment_status === 'paid') markOrderPaid(db, orderId, obj.payment_intent || obj.id);
      return 'ok';
    }
    case 'checkout.session.async_payment_failed': {
      const orderId = obj.client_reference_id || obj.metadata?.order_id;
      if (orderId) db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);
      return 'ok';
    }
    case 'charge.refunded': {
      if (obj.payment_intent) {
        db.prepare("UPDATE orders SET status = 'refunded' WHERE provider_ref = ? AND status = 'paid'").run(obj.payment_intent);
      }
      return 'ok';
    }
    case 'account.updated': {
      db.prepare('UPDATE users SET payouts_enabled = ? WHERE stripe_account = ?').run(
        obj.payouts_enabled && obj.charges_enabled !== false ? 1 : 0,
        obj.id,
      );
      return 'ok';
    }
    default:
      return 'ignored';
  }
}

// ---- Provider interface used by the routes -----------------------------------------------------
export function createCheckout(cfg, { order, listing, seller }) {
  if (cfg.payments === 'mock') {
    return { mock: true, order_id: order.id };
  }
  if (!seller.stripe_account || !seller.payouts_enabled) {
    throw httpError(409, 'This seller has not finished setting up payouts yet, so it cannot be bought right now.');
  }
  return stripe(cfg, 'POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: `${cfg.baseUrl}/#/account/purchases?paid=${order.id}`,
    cancel_url: `${cfg.baseUrl}/#/listing/${listing.id}`,
    client_reference_id: order.id,
    metadata: { order_id: order.id },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: order.amount_pence,
          product_data: { name: listing.title },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: order.fee_pence,
      transfer_data: { destination: seller.stripe_account },
      metadata: { order_id: order.id },
    },
  }).then((session) => ({ url: session.url, provider_ref: session.id }));
}

export async function startPayoutSetup(cfg, db, user) {
  if (cfg.payments === 'mock') {
    db.prepare('UPDATE users SET payouts_enabled = 1 WHERE id = ?').run(user.id);
    return { mock: true, enabled: true };
  }
  let account = user.stripe_account;
  if (!account) {
    const created = await stripe(cfg, 'POST', '/accounts', {
      type: 'express',
      country: 'GB',
      email: user.email,
      capabilities: { transfers: { requested: true } },
      metadata: { user_id: user.id },
    });
    account = created.id;
    db.prepare('UPDATE users SET stripe_account = ? WHERE id = ?').run(account, user.id);
  }
  const link = await stripe(cfg, 'POST', '/account_links', {
    account,
    type: 'account_onboarding',
    refresh_url: `${cfg.baseUrl}/#/account/payouts`,
    return_url: `${cfg.baseUrl}/#/account/payouts`,
  });
  return { url: link.url };
}
