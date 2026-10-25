(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};
  var PAGE = 24;

  var SORTS = [['new', 'Newest'], ['updated', 'Recently updated']];
  var PRICE_SORTS = [['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];
  var selected = function (on) { return on ? FS.ui.raw('selected') : ''; };

  function filterOf(q) {
    return { game: q.game, category: q.category, q: q.q, sort: q.sort, free: q.free, featured: q.featured };
  }

  FS.pages.browse = {
    render: function (ctx) {
      var q = ctx.query;
      var params = filterOf(q);
      params.limit = PAGE;
      return Promise.all([ctx.api.games(), ctx.api.categories(), ctx.api.listings(params), ctx.api.config()]).then(function (r) {
        var games = r[0], cats = r[1], res = r[2], cfg = r[3];
        var paid = cfg.payments !== 'off';
        var sorts = SORTS.concat(paid ? PRICE_SORTS : []);
        ctx.setTitle('Browse - FileShelf');
        var sort = q.sort || 'new';
        var game = games.filter(function (g) { return g.slug === q.game; })[0];
        var cat = cats.filter(function (c) { return c.id === q.category; })[0];
        var heading = game ? game.name : cat ? cat.name : 'Browse';
        return html`
<section class="page-head"><div class="wrap">
  <h1>${heading}</h1>
  <p class="lead">${cat && !game ? cat.description : 'Trainers, save tools, mods and presets for single-player PC games. Every listing is reviewed by a person before it goes live.'}</p>
</div></section>
<section class="band band-flush"><div class="wrap">
  <form class="filters" id="filters" role="search">
    <div class="row-flex">
      <label class="sr" for="f-q">Search listings</label>
      <input class="input" id="f-q" name="q" type="search" placeholder="Search listings" value="${q.q || ''}" maxlength="80">
      <label class="sr" for="f-game">Game</label>
      <select class="select" id="f-game" name="game">
        <option value="">All games</option>
        ${games.map(function (g) { return html`<option value="${g.slug}" ${selected(q.game === g.slug)}>${g.name}</option>`; })}
      </select>
      <label class="sr" for="f-cat">Category</label>
      <select class="select" id="f-cat" name="category">
        <option value="">All categories</option>
        ${cats.map(function (c) { return html`<option value="${c.id}" ${selected(q.category === c.id)}>${c.name}</option>`; })}
      </select>
      <label class="sr" for="f-sort">Sort by</label>
      <select class="select" id="f-sort" name="sort">
        ${sorts.map(function (s) { return html`<option value="${s[0]}" ${selected(sort === s[0])}>${s[1]}</option>`; })}
      </select>
      ${paid ? html`<label class="checkline"><input type="checkbox" name="free" value="1" ${q.free === '1' ? FS.ui.raw('checked') : ''}><span>Free only</span></label>` : ''}
      <label class="checkline"><input type="checkbox" name="featured" value="1" ${q.featured === '1' ? FS.ui.raw('checked') : ''}><span>Featured only</span></label>
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </div>
    <p class="muted" role="status">${FS.ui.plural(res.total, 'listing')}</p>
  </form>
  ${res.listings.length
    ? html`<ul class="cards" id="results">${res.listings.map(FS.ui.card)}</ul>
           ${res.total > res.listings.length ? html`<p class="row-flex"><button class="btn btn-line" id="more" type="button">Load more</button></p>` : ''}`
    : html`<div class="empty"><p>${q.q || q.game || q.category || q.free || q.featured ? 'No listings match those filters.' : 'No listings have been published yet.'}</p>
        <div class="row-flex">${q.q || q.game || q.category || q.free || q.featured ? html`<a class="btn btn-line" href="#/browse">Clear filters</a>` : ''}<a class="btn btn-primary" href="#/sell">Publish a utility</a></div></div>`}
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      var form = el.querySelector('#filters');
      function go() {
        var d = new FormData(form);
        ctx.navigate('/browse' + FS.ui.qs({
          q: String(d.get('q') || '').trim(), game: d.get('game'), category: d.get('category'),
          sort: d.get('sort') === 'new' ? '' : d.get('sort'),
          free: d.get('free') ? '1' : '', featured: d.get('featured') ? '1' : '',
        }));
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); go(); });
      form.querySelectorAll('select, input[type="checkbox"]').forEach(function (s) { s.addEventListener('change', go); });

      var more = el.querySelector('#more');
      var results = el.querySelector('#results');
      if (more) {
        more.addEventListener('click', function () {
          var params = filterOf(ctx.query);
          params.limit = PAGE;
          params.offset = results.children.length;
          more.disabled = true;
          ctx.api.listings(params).then(function (res) {
            results.insertAdjacentHTML('beforeend', res.listings.map(function (l) { return FS.ui.card(l).s; }).join(''));
            if (results.children.length >= res.total) more.remove();
            else more.disabled = false;
          }, function (err) { more.disabled = false; FS.ui.toast(err.message); });
        });
      }
    },
  };
})((window.FS = window.FS || {}));
