(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  FS.pages.creators = {
    render: function (ctx) {
      return ctx.api.creators().then(function (list) {
        ctx.setTitle('Creators - FileShelf');
        return html`
<section class="page-head"><div class="wrap">
  <h1>Creators</h1>
  <p class="lead">The people who make the utilities. A creator appears here once one of their listings has been approved.</p>
</div></section>
<section class="band band-flush"><div class="wrap">
  ${list.length
    ? html`<ul class="cards">${list.map(FS.ui.creatorCard)}</ul>`
    : html`<div class="empty"><p>No creators have published yet.</p><a class="btn btn-primary" href="#/sell">Become a creator</a></div>`}
</div></section>`;
      });
    },
  };

  FS.pages.creator = {
    render: function (ctx) {
      return ctx.api.creator(ctx.params.username).then(function (d) {
        var c = d.creator, mine = !!ctx.state.user && ctx.state.user.username === c.username;
        ctx.setTitle(c.display_name + ' - FileShelf');
        return html`
<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/creators">Creators</a><span aria-hidden="true">/</span><span>${c.display_name}</span></nav></div>
<section class="band band-flush"><div class="wrap stack">
  <div class="stack-sm">
    <h1 class="h1-sm">${c.display_name}</h1>
    ${c.bio ? html`<div class="lead stack-sm">${FS.ui.paragraphs(c.bio)}</div>` : ''}
    <p class="muted">${c.display_name === c.username ? '' : '@' + c.username + '. '}On FileShelf since ${FS.ui.date(c.joined)}. ${FS.ui.plural(c.listings, 'live listing')}.</p>
    ${mine ? html`<p><a class="btn btn-line btn-sm" href="#/account">Edit your profile</a></p>` : ''}
  </div>
  <h2>Listings</h2>
  ${d.listings.length
    ? html`<ul class="cards">${d.listings.map(FS.ui.card)}</ul>`
    : html`<div class="empty"><p>No live listings right now.</p></div>`}
</div></section>`;
      });
    },
  };
})((window.FS = window.FS || {}));
