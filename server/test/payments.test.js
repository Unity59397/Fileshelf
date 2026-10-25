import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encodeForm, verifyStripeSignature, splitAmount } from '../src/payments.js';
import { signToken, verifyToken } from '../src/storage.js';

test('platform fee rounds down and always adds up', () => {
  const cfg = { feeBps: 1000 };
  for (const amount of [99, 100, 101, 1250, 4999, 50000]) {
    const { fee, net } = splitAmount(cfg, amount);
    assert.equal(fee + net, amount);
    assert.equal(fee, Math.floor(amount * 0.1));
  }
});

test('stripe form encoding nests keys the way Stripe expects', () => {
  const out = decodeURIComponent(
    encodeForm({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'gbp' } }], metadata: { order_id: 'x' } }),
  );
  assert.ok(out.includes('line_items[0][quantity]=1'));
  assert.ok(out.includes('line_items[0][price_data][currency]=gbp'));
  assert.ok(out.includes('metadata[order_id]=x'));
});

test('stripe webhook signatures', () => {
  const secret = 'whsec_test';
  const raw = '{"id":"evt_1"}';
  const t = 1_700_000_000;
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const header = `t=${t},v1=${v1}`;
  assert.equal(verifyStripeSignature(raw, header, secret, t + 10), true);
  assert.equal(verifyStripeSignature(raw + ' ', header, secret, t + 10), false, 'tampered body');
  assert.equal(verifyStripeSignature(raw, header, 'whsec_other', t + 10), false, 'wrong secret');
  assert.equal(verifyStripeSignature(raw, header, secret, t + 1000), false, 'too old');
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=abcd,v1=${v1}`, secret, t), true, 'rotated secrets');
  assert.equal(verifyStripeSignature(raw, undefined, secret, t), false);
});

test('download tokens expire and cannot be changed', () => {
  const secret = 'abc';
  const good = signToken(secret, { f: 'file', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verifyToken(secret, good).f, 'file');
  assert.equal(verifyToken('other', good), null);
  assert.equal(verifyToken(secret, signToken(secret, { f: 'file', exp: 1 })), null);
  const [body, mac] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ f: 'other-file', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyToken(secret, `${forged}.${mac}`), null);
  assert.equal(verifyToken(secret, body), null);
  assert.equal(verifyToken(secret, 'nonsense'), null);
});
