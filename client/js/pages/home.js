(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  var pad = function (k) { return (k + '               ').slice(0, 15); };

  FS.pages.home = {
    render: function (ctx) {
      var api = ctx.api;
      return Promise.all([
        api.stats(),
        api.games({ sort: 'listings' }),
        api.listings({ featured: '1', limit: 4 }),
        api.listings({ sort: 'updated', limit: 8 }),
        api.creators(),
      ]).then(function (r) {
        var stats = r[0], games = r[1], featured = r[2].listings, updated = r[3].listings, creators = r[4].slice(0, 4);
        var signedIn = !!ctx.state.user;
        ctx.setTitle('FileShelf: utilities for single-player PC games');

        var consoleText = html`<span class="pr">$</span> ./status
<span class="ok">[ OK ]</span> Reading the catalogue...
${pad('listings')}: ${stats.listings}
${pad('games')}: ${stats.games}
${pad('creators')}: ${stats.sellers}
${pad('player counts')}: not available
<span class="ok">[ OK ]</span> Ready
<span class="pr">$</span> <span class="cursor" aria-hidden="true">_</span>`;

        return html`
<section class="hero-feature">
  <div class="hero-bg"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <h1>Utilities for single-player PC games</h1>
      <p class="lead">Find trainers, save tools, mods and presets for the games you already own. Keep what you download in your Vault, and look up the games they are for in Intel.</p>
      <form class="hero-search" id="hero-search" role="search">
        <label class="sr" for="hero-q">Search games and listings</label>
        <input class="input" id="hero-q" name="q" type="search" placeholder="Search games and listings" maxlength="80" autocomplete="off">
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
      <div class="actions">
        <a class="btn btn-line" href="#/browse">Browse utilities</a>
        <a class="btn btn-line" href="#/intel">Explore games</a>
      </div>
    </div>
    <div class="term" role="group" aria-label="Site status">
      <div class="term-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="term-title">user@fileshelf : /status$</span></div>
      <pre class="term-body" data-type aria-hidden="true">${consoleText}</pre>
      <dl class="sr">
        <dt>Listings</dt><dd>${stats.listings}</dd>
        <dt>Games</dt><dd>${stats.games}</dd>
        <dt>Creators</dt><dd>${stats.sellers}</dd>
        <dt>Player counts</dt><dd>Not available</dd>
      </dl>
    </div>
  </div>
</section>

<section class="band"><div class="wrap">
  <div class="band-head">
    <h2>Games</h2>
    <div class="rail-nav"><a class="more" href="#/intel">All games</a><button class="rail-btn rail-prev" type="button" aria-label="Scroll games left"></button><button class="rail-btn rail-next" type="button" aria-label="Scroll games right"></button></div>
  </div>
  <ul class="cards rail">${games.map(FS.ui.gameTile)}</ul>
</div></section>

${featured.length ? html`<section class="band band-alt"><div class="wrap">
  <div class="band-head"><h2>Featured utilities</h2><a class="more" href="#/browse?featured=1">See all featured</a></div>
  <ul class="cards">${featured.map(FS.ui.card)}</ul>
</div></section>` : ''}

<section class="band ${featured.length ? '' : 'band-alt'}"><div class="wrap">
  <div class="band-head"><h2>Recently updated</h2><a class="more" href="#/browse?sort=updated">Browse all</a></div>
  ${updated.length
    ? html`<ul class="cards">${updated.map(FS.ui.card)}</ul>`
    : html`<div class="empty"><p>Nothing has been published yet. Every listing is reviewed before it appears here.</p><a class="btn btn-primary" href="#/sell">Publish the first utility</a></div>`}
</div></section>

<section class="band ${featured.length ? 'band-alt' : ''}"><div class="wrap">
  <div class="band-head"><h2>Creators</h2><a class="more" href="#/creators">All creators</a></div>
  ${creators.length
    ? html`<ul class="cards">${creators.map(FS.ui.creatorCard)}</ul>`
    : html`<div class="empty"><p>No creators have published yet. Creators appear here after their first listing is approved.</p><a class="btn btn-line" href="#/sell">Become a creator</a></div>`}
</div></section>

<section class="band ${featured.length ? '' : 'band-alt'}"><div class="wrap">
  <div class="band-head"><h2>Intel</h2><a class="more" href="#/intel">Open Intel</a></div>
  <div class="table-scroll intel-peek"><table>
    <thead><tr><th scope="col">Game</th><th scope="col">Developer</th><th scope="col">Released</th><th scope="col">Players now</th></tr></thead>
    <tbody>${games.slice(0, 4).map(function (g) {
      return html`<tr><th scope="row"><a href="#/games/${g.slug}">${g.name}</a></th><td>${g.developer || 'Unknown'}</td><td>${g.release_date ? FS.ui.date(g.release_date) : 'Unknown'}</td><td class="muted">Not available</td></tr>`;
    })}</tbody></table></div>
  <p class="sellnote">Player counts need a Steam data source, and this site does not have one set up yet. Nothing is estimated in the meantime.</p>
</div></section>

<section class="band ${featured.length ? 'band-alt' : ''}"><div class="wrap">
  <div class="panels">
    <div class="panel stack"><h2>My Vault</h2>
      <p>Save listings you want to come back to and see everything you have downloaded in one place. The Vault knows what you downloaded. It cannot see your computer, so it does not claim to know what you have installed.</p>
      <div><a class="btn btn-line" href="#/vault">${signedIn ? 'Open My Vault' : 'Sign in to use the Vault'}</a></div></div>
    <div class="panel stack"><h2>Publish your own</h2>
      <p>Made a save tool, a preset or a mod for a single-player game? Set up a creator profile, upload your file and a moderator will review it before it goes live. Everything is free for now.</p>
      <div><a class="btn btn-line" href="#/sell">Start publishing</a></div></div>
  </div>
</div></section>

<section class="band ${featured.length ? '' : 'band-alt'}"><div class="wrap">
  <div class="band-head"><h2>How it works</h2></div>
  <ol class="howgrid">
    <li class="how"><div class="how-img t1"><span class="how-num">1</span></div><div class="how-body"><h3>Find a utility</h3><p>Browse by game or category, or search. Each listing names the game, the creator, the version and the date it was last updated.</p></div></li>
    <li class="how"><div class="how-img t2"><span class="how-num">2</span></div><div class="how-body"><h3>Check before you download</h3><p>Listings show the file size, a SHA-256 hash and whether the file was scanned. Read the description and the creator's instructions first.</p></div></li>
    <li class="how"><div class="how-img t3"><span class="how-num">3</span></div><div class="how-body"><h3>Keep track in your Vault</h3><p>Save the listings you use. Your download history is kept so you can find a file again.</p></div></li>
  </ol>
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      var form = el.querySelector('#hero-search');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = form.q.value.trim();
        ctx.navigate(q ? '/search' + FS.ui.qs({ q: q }) : '/browse');
      });

      // The console writes itself out when the page opens.
      var pre = el.querySelector('.term-body[data-type]');
      if (pre && !FS.ui.calm) {
        var source = pre.innerHTML;
        pre.style.minHeight = pre.offsetHeight + 'px';
        pre.innerHTML = '';
        pre.setAttribute('data-busy', '1');
        setTimeout(function () {
          FS.ui.typeInto(pre, source).then(function () { pre.removeAttribute('data-busy'); });
        }, 400);
      }
      var rail = el.querySelector('.rail');
      var prev = el.querySelector('.rail-prev');
      var next = el.querySelector('.rail-next');
      function step(dir) {
        rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: FS.ui.calm ? 'auto' : 'smooth' });
      }
      if (rail && prev) prev.addEventListener('click', function () { step(-1); });
      if (rail && next) next.addEventListener('click', function () { step(1); });
    },
  };
})((window.FS = window.FS || {}));
