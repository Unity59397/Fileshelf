(function (FS) {
  'use strict';
  var html = FS.ui.html, size = FS.ui.size;
  FS.pages = FS.pages || {};

  var ROLES = ['user', 'creator', 'moderator', 'admin'];
  var ROLE_NAMES = { user: 'Member', creator: 'Creator', moderator: 'Moderator', admin: 'Admin' };
  var ACTIONS = {
    listing_approve: 'Approved a listing', listing_reject: 'Rejected a listing', listing_remove: 'Removed a listing',
    listing_feature: 'Featured a listing', listing_unfeature: 'Stopped featuring a listing',
    role_change: 'Changed a role', creator_signup: 'Became a creator', bootstrap_admin: 'Became the first admin',
    game_create: 'Added a game', game_update: 'Edited a game',
  };

  function tabsFor(user) {
    var list = [['queue', 'Review queue']];
    if (user.is_admin) list.push(['users', 'Users'], ['games', 'Games'], ['audit', 'Audit log']);
    return list;
  }

  function details(e) {
    var d = e.detail || {};
    if (e.action === 'role_change') return d.username + ': ' + ROLE_NAMES[d.from] + ' to ' + ROLE_NAMES[d.to];
    if (e.action === 'game_update') return (d.fields || []).join(', ');
    return [d.title || d.name || d.email || '', d.reason ? 'Reason: ' + d.reason : ''].filter(Boolean).join('. ');
  }

  var views = {
    queue: function (ctx) {
      return ctx.api.adminQueue().then(function (queue) {
        return html`
  <p class="lead">${FS.ui.plural(queue.length, 'listing is', 'listings are')} waiting. Download the file and check it before approving. A scan result is not a guarantee that a file is safe.</p>
  ${queue.length ? html`<ul class="items">${queue.map(function (q) {
    return html`<li class="item review" data-id="${q.id}">
      <div class="item-main">
        <h3>${q.title}</h3>
        <p class="muted small">${q.game_name}${q.category_name ? ', ' + q.category_name : ''}, ${q.price_pence ? FS.ui.money(q.price_pence) : 'free'}, version ${q.version}. Submitted ${FS.ui.date(q.created_at)} by ${q.seller} (${q.seller_email}).</p>
      </div>
      <div class="stack-sm">
        <p>${q.summary}</p>
        <div class="stack-sm small">${FS.ui.paragraphs(q.description)}</div>
        ${q.features.length ? html`<ul class="ticks small">${q.features.map(function (f) { return html`<li>${f}</li>`; })}</ul>` : ''}
        <dl class="spec">
          <dt>file</dt><dd>${q.paid_name}, ${size(q.paid_size)}</dd>
          <dt>sha-256</dt><dd>${q.paid_sha256}</dd>
          <dt>scan</dt><dd>${FS.ui.scanText(q.paid_scan)}</dd>
          ${q.free_name ? html`<dt>free file</dt><dd>${q.free_name}, ${size(q.free_size)}</dd>` : ''}
          <dt>images</dt><dd>${q.image_count}</dd>
        </dl>
      </div>
      <form class="form review-form" novalidate>
        <p class="form-error" role="alert"></p>
        <div class="field"><label for="r-${q.id}">Reason (needed to reject)</label><input class="input" id="r-${q.id}" name="reason" maxlength="500"></div>
        <div class="row-flex">
          <button class="btn btn-line btn-sm" type="button" data-view="${q.id}">View listing</button>
          <button class="btn btn-line btn-sm" type="button" data-file="${q.id}">Download file</button>
          <button class="btn btn-primary btn-sm" type="button" data-approve="${q.id}">Approve</button>
          <button class="btn btn-line btn-sm" type="button" data-reject="${q.id}">Reject</button>
        </div>
      </form></li>`;
  })}</ul>` : html`<div class="empty"><p>The queue is empty.</p></div>`}`;
      });
    },

    users: function (ctx) {
      var q = ctx.query.q || '';
      return ctx.api.adminUsers(q).then(function (d) {
        return html`
  <form class="filters" id="user-search" role="search"><div class="row-flex">
    <label class="sr" for="u-q">Search users</label>
    <input class="input" id="u-q" name="q" type="search" value="${q}" placeholder="Username or email" maxlength="80">
    <button class="btn btn-primary btn-sm" type="submit">Search</button></div></form>
  <p class="form-error" id="err" role="alert"></p>
  ${d.users.length ? html`<div class="table-scroll"><table>
    <thead><tr><th scope="col">User</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col" class="num">Listings</th><th scope="col"><span class="sr">Save</span></th></tr></thead>
    <tbody>${d.users.map(function (u) {
      var me = u.id === ctx.state.user.id;
      return html`<tr data-user="${u.id}"><th scope="row">${u.username}${u.is_demo ? html` <span class="pill pill-pending">Demo</span>` : ''}${me ? html` <span class="muted">(you)</span>` : ''}</th><td>${u.email}</td>
        <td>${me ? ROLE_NAMES[u.role] : html`<label class="sr" for="role-${u.id}">Role for ${u.username}</label><select class="select" id="role-${u.id}" name="role">${ROLES.map(function (r) {
          return html`<option value="${r}" ${r === u.role ? FS.ui.raw('selected') : ''}>${ROLE_NAMES[r]}</option>`;
        })}</select>`}</td>
        <td class="num">${u.listings}</td>
        <td>${me ? '' : html`<button class="btn btn-line btn-sm" type="button" data-setrole="${u.id}">Save</button>`}</td></tr>`;
    })}</tbody></table></div>` : html`<div class="empty"><p>No users match that search.</p></div>`}
  <p class="sellnote">Moderators can review submissions and remove listings. Admins can also change roles, feature listings, manage games and read the audit log. Every change is recorded.</p>`;
      });
    },

    games: function (ctx) {
      return ctx.api.games().then(function (games) {
        return html`
  <form class="form panel narrow-form" id="game-form" novalidate>
    <h2>Add a game</h2>
    <p class="form-error" id="game-err" role="alert"></p>
    <div class="field"><label for="g-name">Game name</label><input class="input" id="g-name" name="name" maxlength="80" required></div>
    <div class="field-row">
      <div class="field"><label for="g-app">Steam App ID</label><input class="input" id="g-app" name="steam_app_id" inputmode="numeric" maxlength="10"></div>
      <div class="field"><label for="g-date">Release date</label><input class="input" id="g-date" name="release_date" type="date"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="g-dev">Developer</label><input class="input" id="g-dev" name="developer" maxlength="80"></div>
      <div class="field"><label for="g-pub">Publisher</label><input class="input" id="g-pub" name="publisher" maxlength="80"></div>
    </div>
    <div class="field"><label for="g-genres">Genres</label><input class="input" id="g-genres" name="genres" maxlength="100"></div>
    <div class="field"><label for="g-url">Official site</label><input class="input" id="g-url" name="official_url" type="url" placeholder="https://"></div>
    <div class="field"><label for="g-desc">Description</label><textarea class="textarea" id="g-desc" name="description" maxlength="600"></textarea><span class="hint">Write it yourself. Do not paste text from a store page.</span></div>
    <div><button class="btn btn-primary btn-sm" type="submit">Add game</button></div>
  </form>
  <h2>Games</h2>
  <ul class="items">${games.map(function (g) {
    return html`<li class="item" data-game="${g.slug}">
      <div class="item-main"><h3><a href="#/games/${g.slug}">${g.name}</a></h3>
        <p class="muted small">${[g.developer, g.release_date ? FS.ui.date(g.release_date) : '', g.steam_app_id ? 'App ID ' + g.steam_app_id : 'No App ID'].filter(Boolean).join('. ')}</p></div>
      <details data-edit-game="${g.slug}"><summary>Edit details</summary>
        <form class="form" novalidate>
          <p class="form-error" role="alert"></p>
          <div class="field-row">
            <div class="field"><label for="e-app-${g.slug}">Steam App ID</label><input class="input" id="e-app-${g.slug}" name="steam_app_id" inputmode="numeric" maxlength="10"></div>
            <div class="field"><label for="e-date-${g.slug}">Release date</label><input class="input" id="e-date-${g.slug}" name="release_date" type="date"></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="e-dev-${g.slug}">Developer</label><input class="input" id="e-dev-${g.slug}" name="developer" maxlength="80"></div>
            <div class="field"><label for="e-pub-${g.slug}">Publisher</label><input class="input" id="e-pub-${g.slug}" name="publisher" maxlength="80"></div>
          </div>
          <div class="field"><label for="e-gen-${g.slug}">Genres</label><input class="input" id="e-gen-${g.slug}" name="genres" maxlength="100"></div>
          <div class="field"><label for="e-url-${g.slug}">Official site</label><input class="input" id="e-url-${g.slug}" name="official_url" type="url" placeholder="https://"></div>
          <div class="field"><label for="e-desc-${g.slug}">Description</label><textarea class="textarea" id="e-desc-${g.slug}" name="description" maxlength="600"></textarea></div>
          <div><button class="btn btn-primary btn-sm" type="submit">Save details</button></div>
        </form></details></li>`;
  })}</ul>`;
      });
    },

    audit: function (ctx) {
      return ctx.api.adminAudit(0).then(function (d) {
        return html`
  <p class="lead">Every moderation and admin action, newest first. Entries cannot be edited or deleted.</p>
  ${d.entries.length ? html`<div class="table-scroll"><table>
    <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Details</th></tr></thead>
    <tbody id="audit-rows">${auditRows(d.entries)}</tbody></table></div>
    ${d.total > d.entries.length ? html`<p class="row-flex"><button class="btn btn-line" id="older" type="button" data-total="${d.total}">Load older entries</button></p>` : ''}`
  : html`<div class="empty"><p>Nothing has been recorded yet.</p></div>`}`;
      });
    },
  };

  function auditRows(entries) {
    return html`${entries.map(function (e) {
      return html`<tr><td>${FS.ui.dateTime(e.created_at)}</td><td>${e.actor_name || 'System'}</td><td>${ACTIONS[e.action] || e.action}</td><td>${details(e)}</td></tr>`;
    })}`;
  }

  FS.pages.admin = {
    render: function (ctx) {
      ctx.requireUser('/admin');
      var user = ctx.state.user;
      ctx.setTitle('Admin - FileShelf');
      if (!user.is_moderator) {
        return Promise.resolve(html`<section class="page-head"><div class="wrap"><h1>Admin</h1><p class="lead">This page is for moderators and admins.</p></div></section>`);
      }
      var tabList = tabsFor(user);
      var tab = tabList.some(function (t) { return t[0] === ctx.params.tab; }) ? ctx.params.tab : 'queue';
      return views[tab](ctx).then(function (body) {
        return html`
<section class="page-head"><div class="wrap"><h1>${user.is_admin ? 'Admin' : 'Review queue'}</h1></div></section>
<section class="band band-flush"><div class="wrap stack">
  ${tabList.length > 1 ? html`<nav class="tabs" aria-label="Admin sections">${tabList.map(function (t) {
    return html`<a class="tab" href="#/admin${t[0] === 'queue' ? '' : '/' + t[0]}" ${t[0] === tab ? FS.ui.raw('aria-current="page"') : ''}>${t[1]}</a>`;
  })}</nav>` : ''}
  ${body}
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      function item(btn) { return btn.closest('.review'); }
      function errOf(btn) { return item(btn).querySelector('.form-error'); }
      function wire(selector, fn) {
        el.querySelectorAll(selector).forEach(function (b) { b.addEventListener('click', function () { fn(b); }); });
      }

      // Review queue
      wire('[data-view]', function (b) { ctx.navigate('/listing/' + b.getAttribute('data-view')); });
      wire('[data-file]', function (b) {
        ctx.api.startDownload(b.getAttribute('data-file'), 'paid').then(function (d) {
          if (d && d.demo) FS.ui.toast('Demo only: the download would start now.');
        }, function (e) { errOf(b).textContent = e.message; });
      });
      wire('[data-approve]', function (b) {
        ctx.api.adminApprove(b.getAttribute('data-approve')).then(function () {
          FS.ui.toast('Approved');
          ctx.reload();
        }, function (e) { errOf(b).textContent = e.message; });
      });
      wire('[data-reject]', function (b) {
        var reason = item(b).querySelector('[name="reason"]').value.trim();
        if (reason.length < 3) { errOf(b).textContent = 'Write a reason so the creator knows what to fix.'; return; }
        ctx.api.adminReject(b.getAttribute('data-reject'), reason).then(function () {
          FS.ui.toast('Rejected');
          ctx.reload();
        }, function (e) { errOf(b).textContent = e.message; });
      });

      // Users
      var search = el.querySelector('#user-search');
      if (search) {
        search.addEventListener('submit', function (e) {
          e.preventDefault();
          ctx.navigate('/admin/users' + FS.ui.qs({ q: search.q.value.trim() }));
        });
      }
      wire('[data-setrole]', function (b) {
        var row = b.closest('tr');
        var err = el.querySelector('#err');
        err.textContent = '';
        b.disabled = true;
        ctx.api.adminSetRole(b.getAttribute('data-setrole'), row.querySelector('select').value).then(function () {
          FS.ui.toast('Role saved');
          ctx.reload(true);
        }, function (e) { b.disabled = false; err.textContent = e.message; });
      });

      // Games
      function gameBody(form) {
        var out = {};
        ['steam_app_id', 'release_date', 'developer', 'publisher', 'genres', 'official_url', 'description'].forEach(function (k) {
          if (form[k]) out[k] = form[k].value;
        });
        return out;
      }
      var gf = el.querySelector('#game-form');
      if (gf) {
        gf.addEventListener('submit', function (e) {
          e.preventDefault();
          var body = gameBody(gf);
          body.name = gf.name.value;
          ctx.api.adminAddGame(body).then(function (g) {
            FS.ui.toast('Added ' + g.name);
            ctx.reload();
          }, function (e2) { el.querySelector('#game-err').textContent = e2.message; });
        });
      }
      el.querySelectorAll('details[data-edit-game]').forEach(function (d) {
        var slug = d.getAttribute('data-edit-game');
        var form = d.querySelector('form');
        var error = form.querySelector('.form-error');
        var loaded = false;
        d.addEventListener('toggle', function () {
          if (!d.open || loaded) return;
          loaded = true;
          ctx.api.game(slug).then(function (r) {
            var g = r.game;
            form.steam_app_id.value = g.steam_app_id || '';
            form.release_date.value = g.release_date || '';
            form.developer.value = g.developer || '';
            form.publisher.value = g.publisher || '';
            form.genres.value = g.genres || '';
            form.official_url.value = g.official_url || '';
            form.description.value = g.description || '';
          }, function (e) { loaded = false; error.textContent = e.message; });
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          error.textContent = '';
          ctx.api.adminEditGame(slug, gameBody(form)).then(function () {
            FS.ui.toast('Saved');
            ctx.reload(true);
          }, function (e2) { error.textContent = e2.message; });
        });
      });

      // Audit log
      var older = el.querySelector('#older');
      if (older) {
        older.addEventListener('click', function () {
          var rows = el.querySelector('#audit-rows');
          older.disabled = true;
          ctx.api.adminAudit(rows.children.length).then(function (d) {
            rows.insertAdjacentHTML('beforeend', auditRows(d.entries).s);
            if (rows.children.length >= d.total) older.remove();
            else older.disabled = false;
          }, function (e) { older.disabled = false; FS.ui.toast(e.message); });
        });
      }
    },
  };
})((window.FS = window.FS || {}));
