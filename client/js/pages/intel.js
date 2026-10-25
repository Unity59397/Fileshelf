(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  var SORTS = [['name', 'Name'], ['released', 'Newest release'], ['listings', 'Most utilities']];

  // The honest state of player counts. There is no number to show until a Steam data source is set up.
  function playersNotice() {
    return html`<div class="banner"><p><b>Player counts are not available.</b> They come from Steam, and this site does not have a Steam data source set up yet. No numbers are estimated or invented.</p></div>`;
  }

  FS.pages.intel = {
    render: function (ctx) {
      var q = ctx.query;
      var sort = SORTS.some(function (s) { return s[0] === q.sort; }) ? q.sort : 'name';
      return ctx.api.games({ q: q.q, sort: sort }).then(function (games) {
        ctx.setTitle('Intel - FileShelf');
        return html`
<section class="page-head"><div class="wrap">
  <h1>Intel</h1>
  <p class="lead">Facts about the games FileShelf covers: who made them, when they came out, and which utilities exist for them.</p>
</div></section>
<section class="band band-flush"><div class="wrap stack">
  ${playersNotice()}
  <form class="filters" id="intel-filters" role="search">
    <div class="row-flex">
      <label class="sr" for="g-q">Search games</label>
      <input class="input" id="g-q" name="q" type="search" placeholder="Search by name, developer or Steam App ID" value="${q.q || ''}" maxlength="80">
      <label class="sr" for="g-sort">Sort by</label>
      <select class="select" id="g-sort" name="sort">${SORTS.map(function (s) {
        return html`<option value="${s[0]}" ${sort === s[0] ? FS.ui.raw('selected') : ''}>${s[1]}</option>`;
      })}</select>
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </div>
    <p class="muted" role="status">${FS.ui.plural(games.length, 'game')}</p>
  </form>
  ${games.length
    ? html`<ul class="cards">${games.map(FS.ui.gameTile)}</ul>`
    : html`<div class="empty"><p>No games match that search.</p><a class="btn btn-line" href="#/intel">Show all games</a></div>`}
</div></section>`;
      });
    },
    mount: function (el, ctx) {
      var form = el.querySelector('#intel-filters');
      function go() {
        var d = new FormData(form);
        ctx.navigate('/intel' + FS.ui.qs({ q: String(d.get('q') || '').trim(), sort: d.get('sort') === 'name' ? '' : d.get('sort') }));
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); go(); });
      form.querySelector('select').addEventListener('change', go);
    },
  };

  FS.pages.game = {
    render: function (ctx) {
      return Promise.all([
        ctx.api.game(ctx.params.slug),
        ctx.api.listings({ game: ctx.params.slug, sort: 'updated', limit: 8 }),
      ]).then(function (r) {
        var g = r[0].game, players = r[0].players, found = r[1];
        ctx.setTitle(g.name + ' - FileShelf');
        return html`
<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/intel">Intel</a><span aria-hidden="true">/</span><span>${g.name}</span></nav></div>
<section class="band band-flush"><div class="wrap">
  <div class="gamehead">
    <div class="cover t${g.tint} gamehead-cover"><span class="cover-ext">${g.code}<span class="us">_</span></span></div>
    <div class="stack-sm">
      <h1>${g.name}</h1>
      ${g.description ? html`<p class="lead">${g.description}</p>` : ''}
      <p class="row-flex">
        ${g.store_url ? html`<a class="btn btn-line btn-sm" href="${g.store_url}" target="_blank" rel="noopener noreferrer">View on Steam</a>` : ''}
        ${g.official_url ? html`<a class="btn btn-line btn-sm" href="${g.official_url}" target="_blank" rel="noopener noreferrer">Official site</a>` : ''}
        <a class="btn btn-primary btn-sm" href="#/browse?game=${g.slug}">Browse ${FS.ui.plural(g.listings, 'utility', 'utilities')}</a>
      </p>
    </div>
  </div>
</div></section>

<section class="band band-alt"><div class="wrap two-col">
  <div class="stack-sm">
    <h2>Details</h2>
    <dl class="spec">
      <dt>developer</dt><dd>${g.developer || 'Not recorded'}</dd>
      <dt>publisher</dt><dd>${g.publisher || 'Not recorded'}</dd>
      <dt>released</dt><dd>${g.release_date ? FS.ui.date(g.release_date) : 'Not recorded'}</dd>
      <dt>genres</dt><dd>${g.genres || 'Not recorded'}</dd>
      <dt>steam app id</dt><dd>${g.steam_app_id || 'Not recorded'}</dd>
    </dl>
    <p class="sellnote">${g.metadata_source === 'manual'
      ? 'These details were entered by hand' + (g.metadata_updated_at ? ' and last edited ' + FS.ui.date(g.metadata_updated_at) : '') + '. The Steam page is the reference if anything differs.'
      : 'Source: ' + g.metadata_source + '.'}</p>
  </div>
  <div class="stack-sm">
    <h2>Players</h2>
    ${players.status === 'ok' && players.current != null
      ? html`<p class="bignum">${players.current.toLocaleString('en-GB')}</p><p class="muted">Playing now on Steam. Updated ${FS.ui.dateTime(players.updated_at)}.</p>`
      : html`<div class="banner"><p><b>Not available.</b> This site does not have a Steam data source set up, so there is no current player count, daily peak or history to show.</p></div>`}
  </div>
</div></section>

<section class="band"><div class="wrap">
  <div class="band-head"><h2>Utilities for ${g.name}</h2>${found.total > found.listings.length ? html`<a class="more" href="#/browse?game=${g.slug}">See all ${found.total}</a>` : ''}</div>
  ${found.listings.length
    ? html`<ul class="cards">${found.listings.map(FS.ui.card)}</ul>`
    : html`<div class="empty"><p>No utilities for this game yet.</p><a class="btn btn-line" href="#/sell">Publish one</a></div>`}
</div></section>`;
      });
    },
  };

  // One search across games and listings.
  FS.pages.search = {
    render: function (ctx) {
      var q = String(ctx.query.q || '').trim();
      if (!q) {
        ctx.navigate('/browse');
        return Promise.resolve(html``);
      }
      return Promise.all([ctx.api.games({ q: q }), ctx.api.listings({ q: q, limit: 12 })]).then(function (r) {
        var games = r[0], found = r[1];
        ctx.setTitle('Search: ' + q + ' - FileShelf');
        return html`
<section class="page-head"><div class="wrap">
  <h1>Search</h1>
  <p class="lead">Results for "${q}".</p>
</div></section>
<section class="band band-flush"><div class="wrap stack">
  <form class="filters" id="search-form" role="search">
    <div class="row-flex">
      <label class="sr" for="s-q">Search games and listings</label>
      <input class="input" id="s-q" name="q" type="search" value="${q}" maxlength="80">
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </div>
  </form>
  <div class="band-head"><h2>Games</h2>${games.length ? html`<span class="muted">${FS.ui.plural(games.length, 'match', 'matches')}</span>` : ''}</div>
  ${games.length
    ? html`<ul class="cards">${games.map(FS.ui.gameTile)}</ul>`
    : html`<div class="empty"><p>No games match "${q}".</p></div>`}
  <div class="band-head"><h2>Listings</h2>${found.total ? html`<a class="more" href="#/browse${FS.ui.qs({ q: q })}">${found.total > found.listings.length ? 'See all ' + found.total : 'Open in Browse'}</a>` : ''}</div>
  ${found.listings.length
    ? html`<ul class="cards">${found.listings.map(FS.ui.card)}</ul>`
    : html`<div class="empty"><p>No listings match "${q}".</p></div>`}
</div></section>`;
      });
    },
    mount: function (el, ctx) {
      var form = el.querySelector('#search-form');
      if (!form) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = form.q.value.trim();
        ctx.navigate(q ? '/search' + FS.ui.qs({ q: q }) : '/browse');
      });
    },
  };
})((window.FS = window.FS || {}));
