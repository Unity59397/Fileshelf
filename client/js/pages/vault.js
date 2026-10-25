(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  FS.pages.vault = {
    render: function (ctx) {
      ctx.requireUser('/vault');
      return Promise.all([ctx.api.vault(), ctx.api.downloads()]).then(function (r) {
        var saved = r[0], history = r[1];
        ctx.setTitle('My Vault - FileShelf');
        return html`
<section class="page-head"><div class="wrap">
  <h1>My Vault</h1>
  <p class="lead">The listings you saved and the files you downloaded. FileShelf records downloads made on this site. It cannot see your computer, so it does not know what is installed or whether a file is the version you use.</p>
</div></section>
<section class="band band-flush"><div class="wrap stack">
  <h2>Saved listings</h2>
  ${saved.length ? html`<ul class="items">${saved.map(function (l) {
    return html`<li class="item" data-id="${l.id}">
      <div class="item-main">
        <h3><a href="#/listing/${l.id}">${l.title}</a></h3>
        <p class="muted small">${l.game.name}${l.category ? ', ' + l.category.name : ''}. Version ${l.version}, updated ${FS.ui.date(l.updated_at)}. By ${l.seller_display}.</p>
        <p class="muted small">${l.last_downloaded_at ? 'Last downloaded ' + FS.ui.date(l.last_downloaded_at) + '.' : 'Not downloaded yet.'}</p>
      </div>
      <div class="item-side">
        ${l.available ? '' : html`<span class="pill pill-removed">No longer available</span>`}
        ${l.can_download ? html`<button class="btn btn-primary btn-sm" type="button" data-download="${l.id}">Download</button>` : ''}
        <button class="btn btn-line btn-sm" type="button" data-unsave="${l.id}">Remove</button>
      </div></li>`;
  })}</ul>`
  : html`<div class="empty"><p>You have not saved anything yet. Use "Save to Vault" on a listing page.</p><a class="btn btn-primary" href="#/browse">Browse utilities</a></div>`}

  <h2>Download history</h2>
  ${history.length ? html`<div class="table-scroll"><table>
    <thead><tr><th scope="col">Date</th><th scope="col">File</th><th scope="col">Listing</th><th scope="col">Version</th></tr></thead>
    <tbody>${history.map(function (d) {
      return html`<tr><td>${FS.ui.dateTime(d.created_at)}</td><th scope="row" class="file">${d.file_name}</th>
        <td>${d.listing_id ? html`<a href="#/listing/${d.listing_id}">${d.title}</a>${d.listing_status === 'removed' ? html` <span class="pill pill-removed">Removed</span>` : ''}` : 'Not recorded'}</td>
        <td>${d.version || ''}</td></tr>`;
    })}</tbody></table></div>
    <p class="sellnote">The most recent 100 downloads are shown.</p>`
  : html`<div class="empty"><p>No downloads yet.</p></div>`}
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      el.querySelectorAll('[data-download]').forEach(function (b) {
        b.addEventListener('click', function () {
          ctx.api.startDownload(b.getAttribute('data-download'), 'paid').then(function (d) {
            if (d && d.demo) FS.ui.toast('Demo only: the download would start now.');
            setTimeout(function () { ctx.reload(); }, 1200);
          }, function (e) { FS.ui.toast(e.message); });
        });
      });
      el.querySelectorAll('[data-unsave]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          ctx.api.removeFromVault(b.getAttribute('data-unsave')).then(function () {
            FS.ui.toast('Removed from your Vault');
            ctx.reload();
          }, function (e) { b.disabled = false; FS.ui.toast(e.message); });
        });
      });
    },
  };
})((window.FS = window.FS || {}));
