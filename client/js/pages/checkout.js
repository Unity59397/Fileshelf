(function (FS) {
  'use strict';
  var html = FS.ui.html, money = FS.ui.money;
  FS.pages = FS.pages || {};

  // Test checkout. It only exists while the server runs in test payment mode.
  FS.pages.checkout = {
    render: function (ctx) {
      ctx.requireUser('/checkout/' + ctx.params.id);
      ctx.setTitle('Checkout - FileShelf');
      return Promise.all([ctx.api.order(ctx.params.id), ctx.api.config()]).then(function (r) {
        var o = r[0], cfg = r[1];
        var fee = Math.floor((o.amount_pence * cfg.fee_percent) / 100);
        if (o.status === 'paid') {
          return html`<section class="page-head"><div class="wrap narrow"><h1>Already paid</h1><p class="lead">You own ${o.title}.</p>
            <p><a class="btn btn-primary" href="#/account/purchases">Go to your purchases</a></p></div></section>`;
        }
        return html`
<section class="page-head"><div class="wrap narrow"><h1>Checkout</h1></div></section>
<section class="band band-flush"><div class="wrap narrow">
  <div class="panel stack">
    <p class="banner">Test mode. No card is charged and no money moves.</p>
    <dl class="sum">
      <dt>${o.title}</dt><dd>${money(o.amount_pence)}</dd>
      <dt class="total">Total</dt><dd class="total">${money(o.amount_pence)}</dd>
    </dl>
    <p class="hint">${money(o.amount_pence - fee)} goes to the seller. FileShelf keeps ${money(fee)}.</p>
    <p class="form-error" id="err" role="alert"></p>
    <div class="row-flex">
      <button class="btn btn-primary" type="button" data-pay>Pay ${money(o.amount_pence)} (test)</button>
      <a class="btn btn-line" href="#/listing/${o.listing_id}">Cancel</a>
    </div>
  </div>
</div></section>`;
      });
    },
    mount: function (el, ctx) {
      var pay = el.querySelector('[data-pay]');
      if (!pay) return;
      pay.addEventListener('click', function () {
        pay.disabled = true;
        ctx.api.mockPay(ctx.params.id).then(function () {
          FS.ui.toast('Payment received');
          ctx.navigate('/account/purchases?paid=' + encodeURIComponent(ctx.params.id));
        }, function (e) { pay.disabled = false; el.querySelector('#err').textContent = e.message; });
      });
    },
  };
})((window.FS = window.FS || {}));
