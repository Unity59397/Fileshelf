// Starts the app: header, footer, routing, theme switch.
(function (FS) {
  'use strict';
  var html = FS.ui.html;

  FS.demo = !!(window.FILESHELF && window.FILESHELF.demo);
  FS.api = FS.demo && FS.demoApi ? FS.demoApi : FS.realApi;

  var state = { user: null, config: null };
  var header = document.getElementById('header');
  var footer = document.getElementById('footer');
  var content = document.getElementById('content');
  var root = document.documentElement;

  // ---- Routes ----
  var ROUTES = [
    ['/', 'home'],
    ['/browse', 'browse'],
    ['/search', 'search'],
    ['/listing/:id', 'listing'],
    ['/vault', 'vault'],
    ['/intel', 'intel'],
    ['/games/:slug', 'game'],
    ['/creators', 'creators'],
    ['/creators/:username', 'creator'],
    ['/signin', 'signin'],
    ['/signup', 'signup'],
    ['/sell', 'sell'],
    ['/account', 'account'],
    ['/account/:tab', 'account'],
    ['/admin', 'admin'],
    ['/admin/:tab', 'admin'],
    ['/checkout/:id', 'checkout'],
    ['/help', 'help'],
    ['/terms', 'terms'],
  ];

  function Redirect(path) { this.path = path; }

  function match(path) {
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < ROUTES.length; i++) {
      var rp = ROUTES[i][0].split('/').filter(Boolean);
      if (rp.length !== parts.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < rp.length; j++) {
        if (rp[j].charAt(0) === ':') {
          try { params[rp[j].slice(1)] = decodeURIComponent(parts[j]); } catch (e) { ok = false; break; }
        } else if (rp[j] !== parts[j]) { ok = false; break; }
      }
      if (ok) return { page: ROUTES[i][1], params: params, route: ROUTES[i][0] };
    }
    return { page: 'notfound', params: {}, route: '' };
  }

  // The demo keeps its address in memory. The real site uses the part after the # in the URL.
  var memoryPath = '/';
  function currentFull() {
    if (FS.demo) return memoryPath;
    var h = window.location.hash;
    return h.indexOf('#/') === 0 ? h.slice(1) : '/';
  }
  function splitFull(full) {
    var i = full.indexOf('?');
    var path = i < 0 ? full : full.slice(0, i);
    var query = {};
    if (i >= 0) new URLSearchParams(full.slice(i + 1)).forEach(function (v, k) { query[k] = v; });
    return { path: path || '/', query: query };
  }

  function go(full, replace) {
    if (FS.demo) { memoryPath = full; render(); return; }
    var target = '#' + full;
    if (replace) { window.history.replaceState(null, '', target); render(); return; }
    if (window.location.hash === target) { render(); return; }
    window.location.hash = full;
  }

  // ---- Header and footer ----
  var activeRoute = '';
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }

  var NAV_ROUTES = {
    browse: ['/browse', '/search', '/listing/:id'],
    vault: ['/vault'],
    intel: ['/intel', '/games/:slug'],
    creators: ['/creators', '/creators/:username'],
    sell: ['/sell'],
    help: ['/help', '/terms'],
  };
  function here(key) { return NAV_ROUTES[key].indexOf(activeRoute) >= 0; }
  function cur(key) { return here(key) ? FS.ui.raw('aria-current="page"') : ''; }

  // Links for the signed-in person. Used by the account menu on a computer and by the menu sheet on a phone.
  function accountLinks() {
    var u = state.user, cfg = state.config || {};
    var links = [['#/vault', 'My Vault'], ['#/account/listings', 'My listings'], ['#/account', 'Profile']];
    if (cfg.payments && cfg.payments !== 'off') links.push(['#/account/purchases', 'Purchases']);
    if (u.is_admin) links.push(['#/admin', 'Admin']);
    else if (u.is_moderator) links.push(['#/admin', 'Review queue']);
    return links;
  }

  function renderHeader() {
    var u = state.user;
    var account = u
      ? html`<div class="acct" data-acct>
          <button class="acct-btn" type="button" data-acct-toggle aria-expanded="false" aria-controls="acct-menu">${u.username}</button>
          <ul class="acct-menu" id="acct-menu" hidden>
            ${accountLinks().map(function (l) { return html`<li><a href="${l[0]}">${l[1]}</a></li>`; })}
            <li><button class="acct-out" type="button" data-signout>Sign out</button></li>
          </ul></div>`
      : html`<a class="nav-user" href="#/signin" ${activeRoute === '/signin' ? FS.ui.raw('aria-current="page"') : ''}>Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Sign up</a>`;

    var demoBar = FS.demo
      ? html`<div class="demo-bar"><div class="wrap"><p>Demo. Everything runs in this browser and nothing is uploaded. The accounts and listings are made up.
          Try <b>admin@fileshelf.test</b>, <b>moderator@fileshelf.test</b>, <b>creator1@fileshelf.test</b> or <b>member@fileshelf.test</b>, password <b>placeholder-password</b>.</p>
          <button class="btn btn-line btn-sm" type="button" data-demo-reset>Reset demo</button></div></div>`
      : '';
    var seedBar = !FS.demo && state.config && state.config.demo_data
      ? html`<div class="demo-bar"><div class="wrap"><p>This site holds demo data from the development seed script. Items marked "Demo" are not real.</p></div></div>`
      : '';

    var sheetRows = [['#/', 'Home'], ['#/vault', 'My Vault'], ['#/intel', 'Intel'], ['#/creators', 'Creators'], ['#/sell', 'Sell'], ['#/help', 'Help']];

    header.innerHTML = html`${demoBar}${seedBar}<header class="site-head"><div class="wrap">
<span class="brand"><button class="brand-mark" type="button" data-theme-toggle aria-label="Dark mode" aria-pressed="${isDark() ? 'true' : 'false'}">&gt;<span class="us">_</span></button><a class="brand-name" href="#/">FileShelf</a></span>
<div class="head-right">
<nav aria-label="Main"><ul class="nav">
<li class="nav-browse" data-browse-item><a href="#/browse" data-browse-link ${cur('browse')}>Browse</a><button class="nav-more" type="button" data-menu-toggle aria-expanded="false" aria-controls="browse-menu" aria-label="Show games"></button>${menuShell()}</li>
<li><a href="#/vault" ${cur('vault')}>My Vault</a></li>
<li><a href="#/intel" ${cur('intel')}>Intel</a></li>
<li><a href="#/creators" ${cur('creators')}>Creators</a></li>
<li><a href="#/sell" ${cur('sell')}>Sell</a></li>
<li><a href="#/help" ${cur('help')}>Help</a></li>
</ul></nav>
<div class="head-account">${account}</div>
<button class="menu-btn" type="button" data-sheet-toggle aria-expanded="false" aria-controls="site-sheet">Menu</button>
</div>
<div class="mega sheet" id="site-sheet" hidden>
<div class="mega-inner">
<div class="mega-head"><span></span><h2>Menu</h2><button class="mega-close" type="button" data-sheet-close aria-label="Close menu"></button></div>
<ul class="mega-list" aria-label="Pages">${sheetRows.map(function (r) { return menuRow(r[0], r[1]); })}</ul>
<ul class="mega-list" aria-label="Account">${u
  ? html`${accountLinks().map(function (l) { return menuRow(l[0], l[1]); })}<li><button class="sheet-out" type="button" data-signout>Sign out (${u.username})</button></li>`
  : html`${menuRow('#/signin', 'Sign in')}${menuRow('#/signup', 'Sign up')}`}</ul>
</div></div>
</div></header>`.s;
    menu.open = false;
    sheet.open = false;
    acct.open = false;
    root.classList.remove('menu-open');
    fillMenu();
  }

  // ---- Browse menu: a list of games and shortcuts ----
  // On a computer it drops down when the pointer rests on Browse. On a phone it fills the screen.
  var menu = { open: false, hold: false, timer: null, games: null, categories: null };
  var sheet = { open: false };
  var acct = { open: false };
  var narrowQuery = window.matchMedia('(max-width: 48rem)');
  var hoverQuery = window.matchMedia('(hover: hover)');
  var canHover = function () { return hoverQuery.matches && !narrowQuery.matches; };

  function menuShell() {
    return html`<div class="mega" id="browse-menu" hidden>
<div class="mega-inner">
<div class="mega-head"><span></span><h2>Browse</h2><button class="mega-close" type="button" data-menu-close aria-label="Close menu"></button></div>
<div class="mega-side"><ul class="mega-list mega-short" aria-label="Shortcuts"></ul>
<ul class="mega-list mega-cats" aria-label="Categories"></ul></div>
<ul class="mega-list mega-games" aria-label="Games"></ul>
</div></div>`;
  }
  function menuRow(href, name, extra) {
    return html`<li><a href="${href}"><span class="mega-name">${name}</span>${extra || ''}<span class="mega-chev" aria-hidden="true"></span></a></li>`;
  }
  function fillMenu() {
    var short = header.querySelector('.mega-short');
    var cats = header.querySelector('.mega-cats');
    var list = header.querySelector('.mega-games');
    if (!short || !list) return;
    var games = menu.games || [];
    var total = games.reduce(function (n, g) { return n + g.listings; }, 0);
    var paid = state.config && state.config.payments && state.config.payments !== 'off';
    short.innerHTML = html`${menuRow('#/browse', 'All listings', menu.games ? html`<span class="mega-count">${total}</span>` : '')}${menuRow('#/browse?sort=updated', 'Recently updated')}${menuRow('#/browse?featured=1', 'Featured')}${paid ? html`${menuRow('#/browse?free=1', 'Free only')}${menuRow('#/browse?sort=price_asc', 'Lowest price first')}` : ''}`.s;
    cats.innerHTML = html`${(menu.categories || []).map(function (c) {
      return menuRow('#/browse?category=' + c.id, c.name, html`<span class="mega-count">${c.listings}</span>`);
    })}`.s;
    list.innerHTML = html`${games.map(function (g) {
      return html`<li><a href="#/browse?game=${g.slug}"><span class="mega-code">${g.code}<span class="us">_</span></span><span class="mega-name">${g.name}</span><span class="mega-count">${g.listings}</span><span class="mega-chev" aria-hidden="true"></span></a></li>`;
    })}`.s;
  }
  function loadMenuGames() {
    FS.api.games().then(function (g) { menu.games = g; fillMenu(); }, function () {});
    FS.api.categories().then(function (c) { menu.categories = c; fillMenu(); }, function () {});
  }
  function lockScroll() {
    root.classList.toggle('menu-open', (menu.open || sheet.open) && narrowQuery.matches);
  }
  function setMenu(open) {
    var m = document.getElementById('browse-menu');
    if (!m) return;
    if (open) { setSheet(false); setAcct(false); }
    menu.open = open;
    m.hidden = !open;
    var item = header.querySelector('[data-browse-item]');
    if (item) item.classList.toggle('is-open', open);
    var toggle = header.querySelector('[data-menu-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    lockScroll();
    if (open && narrowQuery.matches) { var close = m.querySelector('[data-menu-close]'); if (close) close.focus(); }
  }
  function setSheet(open) {
    var m = document.getElementById('site-sheet');
    if (!m) return;
    if (open) { setMenu(false); setAcct(false); }
    sheet.open = open;
    m.hidden = !open;
    var toggle = header.querySelector('[data-sheet-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    lockScroll();
    if (open) { var close = m.querySelector('[data-sheet-close]'); if (close) close.focus(); }
  }
  function setAcct(open) {
    var m = document.getElementById('acct-menu');
    if (!m) return;
    if (open) { setMenu(false); }
    acct.open = open;
    m.hidden = !open;
    var toggle = header.querySelector('[data-acct-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderFooter() {
    var cfg = state.config || {};
    footer.innerHTML = html`<footer class="site-foot"><div class="wrap">
<p>FileShelf. Utilities for single-player PC games.</p>
<nav aria-label="Footer"><ul class="nav"><li><a href="#/help">Help</a></li><li><a href="#/terms">Content rules</a></li>${cfg.contact_email ? html`<li><a href="mailto:${cfg.contact_email}">Contact</a></li>` : ''}</ul></nav>
<p class="foot-note">Game names, logos and Steam data belong to their owners. FileShelf is not affiliated with Valve or any game publisher.</p>
</div></footer>`.s;
  }

  // ---- Rendering a page ----
  var token = 0;

  function makeCtx(m, query) {
    return {
      api: FS.api,
      state: state,
      params: m.params,
      query: query,
      navigate: function (path) { go(path); },
      reload: function () { render(true); },
      setTitle: function (t) { document.title = t; },
      refreshHeader: renderHeader,
      requireUser: function (next) {
        if (!state.user) throw new Redirect('/signin' + FS.ui.qs({ next: next }));
      },
    };
  }

  function render(keepScroll) {
    var mine = ++token;
    var parsed = splitFull(currentFull());
    var m = match(parsed.path);
    activeRoute = m.route;
    renderHeader();
    loadMenuGames();
    var page = FS.pages[m.page];
    var ctx = makeCtx(m, parsed.query);
    content.setAttribute('aria-busy', 'true');

    var y = window.pageYOffset;
    Promise.resolve()
      .then(function () { return page.render(ctx); })
      .then(function (view) {
        if (mine !== token) return;
        content.innerHTML = view.s;
        content.removeAttribute('aria-busy');
        if (page.mount) page.mount(content, ctx);
        if (keepScroll === true) window.scrollTo(0, y);
        else { window.scrollTo(0, 0); content.focus({ preventScroll: true }); }
      })
      .catch(function (err) {
        if (mine !== token) return;
        if (err instanceof Redirect) { go(err.path, true); return; }
        content.removeAttribute('aria-busy');
        if (err && err.status === 401) { go('/signin' + FS.ui.qs({ next: parsed.path }), true); return; }
        if (err && err.status === 404) {
          FS.pages.notfound.render(ctx).then(function (v) { content.innerHTML = v.s; });
          return;
        }
        if (!(err instanceof FS.ApiError) && window.console) console.error(err);
        content.innerHTML = html`<section class="page-head"><div class="wrap">
<h1>Something went wrong</h1>
<p class="lead">${err instanceof FS.ApiError ? err.message : 'This page could not be shown.'}</p>
<p><button class="btn btn-line" type="button" data-retry>Try again</button></p></div></section>`.s;
      });
  }

  // ---- Clicks anywhere ----
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;

    if (menu.open && !t.closest('[data-browse-item]')) setMenu(false);
    if (acct.open && !t.closest('[data-acct]')) setAcct(false);

    if (t.closest('[data-acct-toggle]')) { setAcct(!acct.open); return; }
    if (t.closest('[data-sheet-toggle]')) { setSheet(!sheet.open); return; }
    if (t.closest('[data-sheet-close]')) {
      setSheet(false);
      var menuBtn = header.querySelector('[data-sheet-toggle]');
      if (menuBtn) menuBtn.focus();
      return;
    }

    if (t.closest('[data-menu-toggle]')) { setMenu(!menu.open); return; }
    if (t.closest('[data-menu-close]')) {
      setMenu(false);
      var back = header.querySelector('[data-menu-toggle]');
      if (back) back.focus();
      return;
    }
    // Without a pointer to hover with, tapping Browse opens the list. "All listings" is the first row.
    if (t.closest('[data-browse-link]') && !canHover()) { e.preventDefault(); setMenu(!menu.open); return; }

    var link = t.closest('a[href^="#/"]');
    // After choosing something, keep the list shut until the pointer leaves Browse.
    if (link && link.closest('[data-browse-item]')) menu.hold = true;
    if (link && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      go(link.getAttribute('href').slice(1));
      return;
    }
    if (t.closest('[data-skip]')) { e.preventDefault(); content.focus(); return; }

    if (t.closest('[data-retry]')) { render(); return; }

    if (t.closest('[data-signout]')) {
      FS.api.logout().then(function () {
        state.user = null;
        FS.ui.toast('Signed out');
        go('/');
      }, function (err) { FS.ui.toast(err.message); });
      return;
    }

    if (t.closest('[data-demo-reset]')) {
      FS.demoApi.reset();
      state.user = null;
      FS.ui.toast('Demo reset');
      go('/');
      return;
    }

    var toggle = t.closest('[data-theme-toggle]');
    if (toggle) {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('fileshelf-theme', next); } catch (err) {}
      document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
        b.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      });
      FS.ui.toast(next + ' mode on');
      echoTheme(next);
    }
  });

  // The home page console answers when the theme changes.
  function echoTheme(name) {
    var pre = content.querySelector('.term-body[data-type]');
    if (!pre || pre.hasAttribute('data-busy')) return;
    var old = pre.querySelector('.cursor');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var line = 'theme --set ' + name + '\n<span class="ok">[ OK ]</span> ' + name + ' mode on\n<span class="pr">$</span> <span class="cursor" aria-hidden="true">_</span>';
    if (FS.ui.calm) { pre.insertAdjacentHTML('beforeend', line); return; }
    pre.setAttribute('data-busy', '1');
    FS.ui.typeInto(pre, line).then(function () { pre.removeAttribute('data-busy'); });
  }

  document.addEventListener('mouseover', function (e) {
    if (!canHover() || !e.target.closest) return;
    if (e.target.closest('[data-browse-item]')) {
      clearTimeout(menu.timer);
      if (!menu.open && !menu.hold) setMenu(true);
    } else if (menu.hold) {
      menu.hold = false;
    } else if (menu.open) {
      clearTimeout(menu.timer);
      menu.timer = setTimeout(function () { setMenu(false); }, 220);
    }
  });
  document.addEventListener('mouseout', function (e) {
    if (canHover() && menu.open && !e.relatedTarget) {
      clearTimeout(menu.timer);
      menu.timer = setTimeout(function () { setMenu(false); }, 220);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var inside = header.contains(document.activeElement);
    if (menu.open) {
      setMenu(false);
      var toggle = header.querySelector('[data-menu-toggle]');
      if (inside && toggle) toggle.focus();
    }
    if (sheet.open) {
      setSheet(false);
      var menuBtn = header.querySelector('[data-sheet-toggle]');
      if (inside && menuBtn) menuBtn.focus();
    }
    if (acct.open) {
      setAcct(false);
      var acctBtn = header.querySelector('[data-acct-toggle]');
      if (inside && acctBtn) acctBtn.focus();
    }
  });
  narrowQuery.addEventListener('change', function () { if (menu.open) setMenu(false); if (sheet.open) setSheet(false); });

  // When an image cannot load, remove it so the placeholder underneath shows.
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-slot') && t.parentNode) t.parentNode.removeChild(t);
  }, true);

  window.addEventListener('hashchange', function () {
    if (FS.demo) return;
    var h = window.location.hash;
    if (h === '' || h.indexOf('#/') === 0) render();
  });

  // ---- Start ----
  Promise.all([
    FS.api.me().then(function (u) { state.user = u; }, function () { state.user = null; }),
    FS.api.config().then(function (c) { state.config = c; }, function () { state.config = null; }),
  ]).then(function () {
    renderFooter();
    render();
  });
})((window.FS = window.FS || {}));
