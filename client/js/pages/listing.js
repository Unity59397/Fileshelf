(function (FS) {
  'use strict';
  var html = FS.ui.html, money = FS.ui.money, size = FS.ui.size;
  FS.pages = FS.pages || {};

  function gallery(l) {
    if (!l.images.length) {
      return html`<div class="stage t${l.game.tint}"><figure class="slot t${l.game.tint}"><figcaption class="slot-hint"><b>${l.game.code}_</b><span>No images yet</span></figcaption></figure></div>`;
    }
    return html`<div data-gallery>
      <div class="stage t${l.game.tint}">${l.images.map(function (id, i) {
        return html`<figure class="slot t${l.game.tint}" ${i ? FS.ui.raw('hidden') : ''}><img src="${FS.api.imageUrl(id)}" alt="${l.title}, image ${i + 1} of ${l.images.length}"></figure>`;
      })}</div>
      ${l.images.length > 1 ? html`<div class="thumbs">${l.images.map(function (id, i) {
        return html`<button type="button" aria-label="Show image ${i + 1}" aria-current="${i ? 'false' : 'true'}"><span class="slot t${l.game.tint}"><img src="${FS.api.imageUrl(id)}" alt=""></span></button>`;
      })}</div>` : ''}
    </div>`;
  }

  function actions(l, user, cfg) {
    var v = l.viewer;
    var free = l.has_free
      ? html`<button class="btn btn-free btn-block" type="button" data-download="free">Download the free version (${size(l.free_file.size)})</button>`
      : '';
    var save = l.status === 'approved'
      ? html`<button class="btn btn-line btn-block" type="button" data-save aria-pressed="${v.saved ? 'true' : 'false'}">${v.saved ? 'Saved to your Vault' : 'Save to Vault'}</button>`
      : '';
    if (v.is_seller || v.is_moderator) {
      var note = {
        pending: 'This listing is waiting for review. Only you and the moderators can see it.',
        approved: 'This listing is live.',
        rejected: 'This listing needs changes before it can go live.',
        withdrawn: 'This listing was withdrawn. People who bought it can still download it.',
        removed: 'This listing was removed.',
      }[l.status];
      return html`
        <div class="banner ${l.status === 'approved' ? 'good' : l.status === 'pending' ? '' : 'bad'}">
          <p>${v.is_seller ? 'This is your listing. ' : ''}${note}</p>
          ${l.reject_reason ? html`<p><b>Reason:</b> ${l.reject_reason}</p>` : ''}
        </div>
        <div class="buy-actions">
          <button class="btn btn-primary btn-block" type="button" data-download="paid">Download the ${l.is_free ? 'file' : 'full file'}</button>
          ${free}
          ${save}
          ${v.is_seller ? html`<a class="btn btn-line btn-block" href="#/account/listings">Manage your listings</a>` : ''}
        </div>`;
    }
    if (l.is_free) {
      return html`<div class="buy-actions">
        ${user
          ? html`<button class="btn btn-primary btn-block" type="button" data-download="paid">Download (${size(l.paid_file.size)})</button>`
          : html`<a class="btn btn-primary btn-block" href="#/signin${FS.ui.qs({ next: '/listing/' + l.id })}">Sign in to download</a>`}
        ${save}
      </div>`;
    }
    if (v.owned) {
      return html`
        <div class="banner good"><p>You own this listing.</p></div>
        <div class="buy-actions"><button class="btn btn-primary btn-block" type="button" data-download="paid">Download your file</button>${free}${save}</div>`;
    }
    if (cfg.payments === 'off') {
      return html`<div class="banner"><p>Paid downloads are not available yet, so this listing cannot be bought right now.</p></div>
        <div class="buy-actions">${free}${save}</div>`;
    }
    return html`<div class="buy-actions">
      <button class="btn btn-primary btn-block" type="button" data-buy>Buy for ${money(l.price_pence)}</button>
      ${free}
      ${save}
    </div>`;
  }

  FS.pages.listing = {
    render: function (ctx) {
      return Promise.all([ctx.api.listing(ctx.params.id), ctx.api.config()]).then(function (r) {
        var l = r[0], cfg = r[1];
        ctx.setTitle(l.title + ' - FileShelf');
        var user = ctx.state.user;
        return html`
<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/browse">Browse</a><span aria-hidden="true">/</span><a href="#/browse?game=${l.game.slug}">${l.game.name}</a>${l.category ? html`<span aria-hidden="true">/</span><a href="#/browse?category=${l.category.id}">${l.category.name}</a>` : ''}</nav></div>
<section class="product-top"><div class="wrap"><div class="product">
  ${gallery(l)}
  <div class="buybox" data-listing="${l.id}">
    <p class="tags"><a class="pill" href="#/games/${l.game.slug}">${l.game.name}</a>${l.category ? html`<span class="pill">${l.category.name}</span>` : ''}${l.is_free ? html`<span class="pill pill-free">Free</span>` : l.has_free ? html`<span class="pill pill-free">Free version</span>` : ''}${l.is_demo ? html`<span class="pill pill-pending">Demo data</span>` : ''}${l.status !== 'approved' ? FS.ui.pill(l.status) : ''}</p>
    <h1>${l.title}</h1>
    <p class="lead">${l.summary}</p>
    <p class="price-line"><span class="price">${FS.ui.priceText(l)}</span>${l.is_free ? '' : html`<span class="muted">one payment</span>`}</p>
    ${l.is_demo ? html`<div class="banner"><p>This is demo data made by the development seed script. The file does nothing.</p></div>` : ''}
    ${actions(l, user, cfg)}
    <p class="form-error" id="err" role="alert"></p>
    <dl class="spec">
      <dt>creator</dt><dd><a href="#/creators/${l.seller}">${l.seller_display}</a></dd>
      <dt>version</dt><dd>${l.version}</dd>
      <dt>file</dt><dd>${l.paid_file.name}, ${size(l.paid_file.size)}</dd>
      ${l.free_file ? html`<dt>free file</dt><dd>${l.free_file.name}, ${size(l.free_file.size)}</dd>` : ''}
      <dt>scan</dt><dd>${FS.ui.scanText(l.paid_file.scan_status)}</dd>
      <dt>sha-256</dt><dd title="${l.paid_file.sha256}">${l.paid_file.sha256.slice(0, 16)}...</dd>
      <dt>published</dt><dd>${FS.ui.date(l.created_at)}</dd>
      <dt>updated</dt><dd>${FS.ui.date(l.updated_at)}</dd>
    </dl>
    ${l.viewer.is_admin && l.status === 'approved'
      ? html`<p><button class="btn btn-line btn-sm" type="button" data-feature="${l.featured ? 'off' : 'on'}">${l.featured ? 'Remove from featured' : 'Feature this listing'}</button></p>` : ''}
    ${l.viewer.is_moderator && l.status === 'approved' ? html`
      <details class="panel stack-sm" id="remove-box"><summary>Remove this listing</summary>
        <form class="form" id="remove-form">
          <div class="field"><label for="rm-reason">Reason</label><input class="input" id="rm-reason" name="reason" maxlength="500" required></div>
          <button class="btn btn-line btn-sm" type="submit">Remove listing</button>
        </form></details>` : ''}
  </div>
</div></div></section>

${l.features.length ? html`<section class="band band-alt"><div class="wrap">
  <h2>What's included</h2>
  <ul class="features">${l.features.map(function (f) { return html`<li>${f}</li>`; })}</ul>
</div></section>` : ''}

<section class="band"><div class="wrap stack">
  <h2>Description</h2>
  <div class="stack-sm lead">${FS.ui.paragraphs(l.description)}</div>
  <p class="sellnote">Keep a backup of your saves before using any utility, and only use files from creators you trust. Listings that contain malware or break the rules are removed. <a class="more" href="#/terms">Read the content rules</a>.</p>
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      var box = el.querySelector('.buybox');
      var id = box.getAttribute('data-listing');
      var err = el.querySelector('#err');
      var fail = function (e) { err.textContent = e.message; };

      var g = el.querySelector('[data-gallery]');
      if (g) {
        var slots = g.querySelectorAll('.stage .slot');
        var thumbs = g.querySelectorAll('.thumbs button');
        thumbs.forEach(function (btn, i) {
          btn.addEventListener('click', function () {
            slots.forEach(function (s, j) { s.hidden = j !== i; });
            thumbs.forEach(function (t, j) { t.setAttribute('aria-current', j === i ? 'true' : 'false'); });
          });
        });
      }

      var save = el.querySelector('[data-save]');
      if (save) {
        save.addEventListener('click', function () {
          err.textContent = '';
          if (!ctx.state.user) return ctx.navigate('/signin' + FS.ui.qs({ next: '/listing/' + id }));
          var saved = save.getAttribute('aria-pressed') === 'true';
          save.disabled = true;
          (saved ? ctx.api.removeFromVault(id) : ctx.api.saveToVault(id)).then(function () {
            save.disabled = false;
            save.setAttribute('aria-pressed', saved ? 'false' : 'true');
            save.textContent = saved ? 'Save to Vault' : 'Saved to your Vault';
            FS.ui.toast(saved ? 'Removed from your Vault' : 'Saved to your Vault');
          }, function (e) { save.disabled = false; fail(e); });
        });
      }

      var feature = el.querySelector('[data-feature]');
      if (feature) {
        feature.addEventListener('click', function () {
          feature.disabled = true;
          ctx.api.adminFeature(id, feature.getAttribute('data-feature') === 'on').then(function () {
            FS.ui.toast('Saved');
            ctx.reload();
          }, function (e) { feature.disabled = false; fail(e); });
        });
      }

      var buy = el.querySelector('[data-buy]');
      if (buy) {
        buy.addEventListener('click', function () {
          err.textContent = '';
          if (!ctx.state.user) return ctx.navigate('/signin' + FS.ui.qs({ next: '/listing/' + id }));
          buy.disabled = true;
          ctx.api.checkout(id).then(function (r) {
            if (r.mock) ctx.navigate('/checkout/' + r.order_id);
            else if (r.url) window.location.assign(r.url);
          }, function (e) { buy.disabled = false; fail(e); });
        });
      }

      el.querySelectorAll('[data-download]').forEach(function (b) {
        b.addEventListener('click', function () {
          err.textContent = '';
          ctx.api.startDownload(id, b.getAttribute('data-download')).then(function (d) {
            if (d && d.demo) FS.ui.toast('Demo only: the download would start now.');
          }, fail);
        });
      });

      var rm = el.querySelector('#remove-form');
      if (rm) {
        rm.addEventListener('submit', function (e) {
          e.preventDefault();
          ctx.api.adminRemove(id, rm.reason.value).then(function () {
            FS.ui.toast('Listing removed');
            ctx.navigate('/admin');
          }, fail);
        });
      }
    },
  };
})((window.FS = window.FS || {}));
