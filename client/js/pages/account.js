(function (FS) {
  'use strict';
  var html = FS.ui.html, money = FS.ui.money;
  FS.pages = FS.pages || {};

  var PAYMENT_TABS = ['purchases', 'sales', 'payouts'];
  var ROLE_NAMES = { user: 'Member', creator: 'Creator', moderator: 'Moderator', admin: 'Admin' };

  function tabList(cfg) {
    var list = [['profile', 'Profile'], ['listings', 'My listings']];
    if (cfg.payments !== 'off') list.push(['purchases', 'Purchases'], ['sales', 'Sales'], ['payouts', 'Payouts']);
    return list;
  }

  function tabs(active, cfg) {
    return html`<nav class="tabs" aria-label="Account sections">${tabList(cfg).map(function (t) {
      return html`<a class="tab" href="#/account/${t[0]}" ${t[0] === active ? FS.ui.raw('aria-current="page"') : ''}>${t[1]}</a>`;
    })}</nav>`;
  }

  function empty(text, linkHref, linkText) {
    return html`<div class="empty"><p>${text}</p>${linkHref ? html`<a class="btn btn-primary" href="${linkHref}">${linkText}</a>` : ''}</div>`;
  }

  var views = {
    profile: function (ctx) {
      var u = ctx.state.user;
      return ctx.api.myCreator().then(function (p) {
        var creator = !!p;
        return html`<div class="panel stack narrow-form">
          <dl class="spec">
            <dt>username</dt><dd>${u.username}</dd>
            <dt>email</dt><dd>${u.email}</dd>
            <dt>role</dt><dd>${ROLE_NAMES[u.role] || u.role}</dd>
          </dl>
          <form class="form" id="profile-form" novalidate>
            <h2>${creator ? 'Creator profile' : 'Become a creator'}</h2>
            <p class="muted">${creator
              ? 'This is shown on your listings and on your creator page.'
              : 'Creators can publish listings. A moderator reviews every listing before it goes live.'}</p>
            <p class="form-error" id="err" role="alert"></p>
            <div class="field"><label for="display_name">Display name</label><input class="input" id="display_name" name="display_name" maxlength="40" value="${creator ? p.display_name : u.username}" required></div>
            <div class="field"><label for="bio">About you</label><textarea class="textarea" id="bio" name="bio" maxlength="500">${creator ? p.bio : ''}</textarea><span class="hint">Up to 500 characters.</span></div>
            <div class="row-flex"><button class="btn btn-primary" type="submit">${creator ? 'Save profile' : 'Create creator profile'}</button>
              ${creator ? html`<a class="btn btn-line" href="#/creators/${u.username}">View your page</a>` : ''}</div>
          </form></div>`;
      });
    },

    purchases: function (ctx) {
      return ctx.api.myOrders().then(function (orders) {
        var banner = ctx.query.paid ? html`<div class="banner good"><p>Payment received. Your file is ready to download below.</p></div>` : '';
        if (!orders.length) return html`${banner}${empty('You have not bought anything yet.', '#/browse', 'Browse listings')}`;
        return html`${banner}<ul class="items">${orders.map(function (o) {
          return html`<li class="item">
            <div class="item-main"><h3><a href="#/listing/${o.listing_id}">${o.title}</a></h3>
              <p class="muted small">${o.game_name} by ${o.seller}. Bought ${FS.ui.date(o.paid_at || o.created_at)} for ${money(o.amount_pence)}.</p></div>
            <div class="item-side">
              ${o.status === 'refunded' ? html`<span class="pill pill-removed">Refunded</span>`
                : o.can_download ? html`<button class="btn btn-primary btn-sm" type="button" data-download="${o.listing_id}">Download</button>`
                : html`<span class="pill pill-removed">No longer available</span>`}
            </div></li>`;
        })}</ul>`;
      });
    },

    listings: function (ctx) {
      return Promise.all([ctx.api.myListings(), ctx.api.categories(), ctx.api.config()]).then(function (r) {
        var list = r[0], cats = r[1], paid = r[2].payments !== 'off';
        if (!list.length) return empty('You have not added a listing yet.', '#/sell', 'Add a listing');
        return html`<p class="row-flex"><a class="btn btn-primary btn-sm" href="#/sell">Add a listing</a></p>
          <ul class="items">${list.map(function (l) {
            var open = ['pending', 'approved', 'rejected'].indexOf(l.status) >= 0;
            return html`<li class="item" data-id="${l.id}">
              <div class="item-main"><h3><a href="#/listing/${l.id}">${l.title}</a></h3>
                <p class="muted small">${l.game.name}${l.category ? ', ' + l.category.name : ''}, ${FS.ui.priceText(l)}, ${FS.ui.plural(l.downloads, 'download')}${paid ? ', ' + FS.ui.plural(l.sales, 'sale') : ''}</p>
                ${l.reject_reason ? html`<p class="small"><b>Reason:</b> ${l.reject_reason}</p>` : ''}</div>
              <div class="item-side">${FS.ui.pill(l.status)}
                ${open ? html`<button class="btn btn-line btn-sm" type="button" data-withdraw="${l.id}">Withdraw</button>` : ''}</div>
              ${open ? html`<details data-edit="${l.id}"><summary>Edit</summary>
                <form class="form" novalidate>
                  <p class="form-error" role="alert"></p>
                  <div class="field"><label for="t-${l.id}">Title</label><input class="input" id="t-${l.id}" name="title" maxlength="80"></div>
                  <div class="field"><label for="s-${l.id}">Short summary</label><input class="input" id="s-${l.id}" name="summary" maxlength="160"></div>
                  <div class="field"><label for="d-${l.id}">Description</label><textarea class="textarea" id="d-${l.id}" name="description" maxlength="5000"></textarea></div>
                  <div class="field"><label for="f-${l.id}">Features</label><textarea class="textarea" id="f-${l.id}" name="features"></textarea></div>
                  <div class="field"><label for="c-${l.id}">Category</label><select class="select" id="c-${l.id}" name="category">${cats.map(function (c) { return html`<option value="${c.id}">${c.name}</option>`; })}</select></div>
                  ${paid ? html`<div class="field"><label for="p-${l.id}">Price</label><div class="money"><input class="input" id="p-${l.id}" name="price" inputmode="decimal" placeholder="Leave blank for free"></div></div>` : ''}
                  <p class="hint">Saving sends the listing back for review.</p>
                  <div><button class="btn btn-primary btn-sm" type="submit">Save changes</button></div>
                </form></details>` : ''}
            </li>`;
          })}</ul>`;
      });
    },

    sales: function (ctx) {
      return ctx.api.mySales().then(function (d) {
        var t = d.totals;
        var stats = html`<div class="stats">
          <div class="stat"><b>${t.count}</b><span>Sales</span></div>
          <div class="stat"><b>${money(t.gross_pence)}</b><span>Total paid by buyers</span></div>
          <div class="stat"><b>${money(t.fee_pence)}</b><span>FileShelf fee</span></div>
          <div class="stat"><b>${money(t.net_pence)}</b><span>Your earnings</span></div></div>`;
        if (!d.sales.length) return html`${stats}${empty('No sales yet.')}`;
        return html`${stats}<div class="table-scroll"><table>
          <thead><tr><th scope="col">Listing</th><th scope="col">Buyer</th><th scope="col">Date</th><th scope="col" class="num">Paid</th><th scope="col" class="num">You earn</th></tr></thead>
          <tbody>${d.sales.map(function (s) {
            return html`<tr><th scope="row">${s.title}${s.status === 'refunded' ? html` <span class="pill pill-removed">Refunded</span>` : ''}</th><td>${s.buyer}</td><td>${FS.ui.date(s.paid_at)}</td><td class="num">${money(s.amount_pence)}</td><td class="num">${money(s.seller_net_pence)}</td></tr>`;
          })}</tbody></table></div>`;
      });
    },

    payouts: function (ctx) {
      return ctx.api.mySales().then(function (d) {
        var on = d.payouts_enabled;
        return html`<div class="panel stack narrow-form">
          <h2>Payouts</h2>
          <p>${on ? 'Payouts are set up. Your share of each sale is sent to you by the payment provider.' : 'Set up payouts so buyers can pay you. You will be taken to the payment provider to confirm your details.'}</p>
          ${d.payments === 'mock' ? html`<p class="banner">Test mode: no real account is created and no money moves.</p>` : ''}
          <p class="form-error" id="err" role="alert"></p>
          <div><button class="btn ${on ? 'btn-line' : 'btn-primary'}" type="button" data-connect>${on ? 'Manage payout details' : 'Set up payouts'}</button></div>
        </div>`;
      });
    },
  };

  FS.pages.account = {
    render: function (ctx) {
      ctx.requireUser('/account');
      return ctx.api.config().then(function (cfg) {
        var allowed = tabList(cfg).map(function (t) { return t[0]; });
        var tab = allowed.indexOf(ctx.params.tab) >= 0 ? ctx.params.tab : 'profile';
        ctx.setTitle('Account - FileShelf');
        return views[tab](ctx).then(function (body) { return [tab, cfg, body]; });
      }).then(function (r) {
        var tab = r[0], cfg = r[1], body = r[2];
        return html`
<section class="page-head"><div class="wrap">
  <h1>${ctx.state.user.username}</h1>
  <p class="lead">${ctx.state.user.email}</p>
</div></section>
<section class="band band-flush"><div class="wrap">${tabs(tab, cfg)}${body}</div></section>`;
      });
    },

    mount: function (el, ctx) {
      var err = el.querySelector('#err');

      var pform = el.querySelector('#profile-form');
      if (pform) {
        pform.addEventListener('submit', function (e) {
          e.preventDefault();
          err.textContent = '';
          var b = pform.querySelector('button[type="submit"]');
          b.disabled = true;
          ctx.api.saveCreator({ display_name: pform.display_name.value, bio: pform.bio.value }).then(function () {
            return ctx.api.me();
          }).then(function (u) {
            ctx.state.user = u;
            ctx.refreshHeader();
            FS.ui.toast('Profile saved');
            ctx.reload();
          }, function (e2) { b.disabled = false; err.textContent = e2.message; });
        });
      }

      el.querySelectorAll('[data-download]').forEach(function (b) {
        b.addEventListener('click', function () {
          ctx.api.startDownload(b.getAttribute('data-download'), 'paid').then(function (d) {
            if (d && d.demo) FS.ui.toast('Demo only: the download would start now.');
          }, function (e) { FS.ui.toast(e.message); });
        });
      });

      el.querySelectorAll('[data-withdraw]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-sure') !== 'yes') {
            b.setAttribute('data-sure', 'yes');
            b.textContent = 'Withdraw this listing?';
            return;
          }
          ctx.api.withdraw(b.getAttribute('data-withdraw')).then(function () {
            FS.ui.toast('Listing withdrawn');
            ctx.reload();
          }, function (e) { FS.ui.toast(e.message); });
        });
      });

      el.querySelectorAll('details[data-edit]').forEach(function (d) {
        var id = d.getAttribute('data-edit');
        var form = d.querySelector('form');
        var error = form.querySelector('.form-error');
        var loaded = false;
        d.addEventListener('toggle', function () {
          if (!d.open || loaded) return;
          loaded = true;
          ctx.api.listing(id).then(function (l) {
            form.title.value = l.title;
            form.summary.value = l.summary;
            form.description.value = l.description;
            form.features.value = l.features.join('\n');
            if (form.category && l.category) form.category.value = l.category.id;
            if (form.price) form.price.value = l.price_pence ? (l.price_pence / 100).toFixed(2) : '';
          }, function (e) { error.textContent = e.message; });
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          error.textContent = '';
          var patch = {
            title: form.title.value, summary: form.summary.value, description: form.description.value,
            features: form.features.value, category: form.category.value,
          };
          if (form.price) patch.price = form.price.value;
          ctx.api.updateListing(id, patch).then(function () {
            FS.ui.toast('Saved. The listing is back in review.');
            ctx.reload();
          }, function (e2) { error.textContent = e2.message; });
        });
      });

      var connect = el.querySelector('[data-connect]');
      if (connect) {
        connect.addEventListener('click', function () {
          connect.disabled = true;
          ctx.api.connectPayouts().then(function (r) {
            if (r.url) return window.location.assign(r.url);
            return ctx.api.me().then(function (u) { ctx.state.user = u; FS.ui.toast('Payouts set up (test mode)'); ctx.reload(); });
          }, function (e) { connect.disabled = false; err.textContent = e.message; });
        });
      }
    },
  };
})((window.FS = window.FS || {}));
