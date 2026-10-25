// Shared helpers. Everything hangs off window.FS so the pages can be plain script files.
(function (FS) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  // html`...` escapes everything you put in it unless it is already trusted markup.
  function Raw(s) { this.s = s; }
  function raw(s) { return new Raw(s); }
  function val(v) {
    if (v == null || v === false) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    return esc(v);
  }
  function html(strings) {
    var out = '';
    for (var i = 0; i < strings.length; i++) {
      out += strings[i];
      if (i + 1 < strings.length) out += val(arguments[i + 1]);
    }
    return new Raw(out);
  }

  function money(pence) {
    var pounds = pence / 100;
    return '£' + (pence % 100 === 0 ? String(pounds) : pounds.toFixed(2));
  }
  function size(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }
  // Accepts a timestamp, or a plain date such as "2022-02-25" (shown as that day wherever the reader is).
  function date(ts) {
    var d = typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)
      ? new Date(Number(ts.slice(0, 4)), Number(ts.slice(5, 7)) - 1, Number(ts.slice(8, 10)))
      : new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dateTime(ts) {
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function qs(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }
  function paragraphs(text) {
    return html`${String(text).split(/(?:\r?\n){2,}/).map(function (p) { return html`<p>${p}</p>`; })}`;
  }

  var STATUS = {
    pending: 'Waiting for review',
    approved: 'Live',
    rejected: 'Changes needed',
    withdrawn: 'Withdrawn',
    removed: 'Removed',
  };
  function pill(status) {
    return html`<span class="pill pill-${status}">${STATUS[status] || status}</span>`;
  }

  function cover(game, coverId) {
    return html`<div class="cover t${game.tint}">${coverId ? html`<img data-slot src="${FS.api.imageUrl(coverId)}" alt="" loading="lazy">` : ''}<span class="cover-ext">${game.code}<span class="us">_</span></span></div>`;
  }

  var priceText = function (l) { return l.price_pence === 0 ? 'Free' : money(l.price_pence); };

  function card(l) {
    var badge = l.is_demo ? html`<span class="badge badge-demo">Demo data</span>`
      : l.price_pence === 0 ? html`<span class="badge">Free</span>`
      : l.has_free ? html`<span class="badge">Free version</span>` : '';
    return html`<li><article class="card">
      <div class="cover t${l.game.tint}">${l.cover_id ? html`<img data-slot src="${FS.api.imageUrl(l.cover_id)}" alt="" loading="lazy">` : ''}<span class="cover-ext">${l.game.code}<span class="us">_</span></span>${badge}</div>
      <div class="card-body">
        <p class="card-cat">${l.game.name}${l.category ? html` &middot; ${l.category.name}` : ''}</p>
        <h3><a href="#/listing/${l.id}">${l.title}</a></h3>
        <p class="card-sum">${l.summary}</p>
        <p class="card-foot"><span class="price-sm">${priceText(l)}</span><span class="size-sm">${l.seller_display || l.seller}</span></p>
      </div></article></li>`;
  }

  // A game as a tile. Used on the home page and in the Intel directory.
  function gameTile(g) {
    return html`<li><article class="card game-tile">
      <div class="cover t${g.tint}"><span class="cover-ext">${g.code}<span class="us">_</span></span></div>
      <div class="card-body">
        <h3><a href="#/games/${g.slug}">${g.name}</a></h3>
        <p class="card-sum">${[g.developer, g.release_date ? g.release_date.slice(0, 4) : ''].filter(Boolean).join(', ')}</p>
        <p class="card-foot"><span class="size-sm">${g.listings} ${g.listings === 1 ? 'utility' : 'utilities'}</span></p>
      </div></article></li>`;
  }

  function creatorCard(c) {
    return html`<li><article class="card person">
      <div class="card-body">
        <h3><a href="#/creators/${c.username}">${c.display_name}</a></h3>
        <p class="card-sum">${c.bio || 'No bio yet.'}</p>
        <p class="card-foot"><span class="size-sm">${plural(c.listings, 'listing')}</span></p>
      </div></article></li>`;
  }

  // What a scan result means. Never says a file is safe: a scan cannot promise that.
  function scanText(status) {
    if (status === 'clean') return 'Scanned, nothing found. A scan cannot promise a file is safe.';
    return 'Not scanned. Treat the file with care.';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  // Small message at the bottom of the screen.
  var toastEl, toastTimer;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = '> ' + message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Writes HTML into a <pre> one character at a time, keeping the colours of its spans.
  function typeInto(pre, htmlStr) {
    return new Promise(function (resolve) {
      var holder = document.createElement('span');
      holder.innerHTML = htmlStr;
      pre.appendChild(holder);
      var nodes = [];
      (function walk(n) {
        Array.prototype.forEach.call(n.childNodes, function (c) {
          if (c.nodeType === 3) { nodes.push({ node: c, text: c.nodeValue }); c.nodeValue = ''; } else walk(c);
        });
      })(holder);
      var caret = document.createElement('span');
      caret.className = 'caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.textContent = '_';
      var i = 0, j = 0;
      function tick() {
        if (!pre.isConnected) return resolve();
        if (i >= nodes.length) {
          if (caret.parentNode) caret.parentNode.removeChild(caret);
          return resolve();
        }
        var item = nodes[i];
        j += 1;
        item.node.nodeValue = item.text.slice(0, j);
        if (item.node.parentNode) item.node.parentNode.insertBefore(caret, item.node.nextSibling);
        var ch = item.text.charAt(j - 1);
        if (j >= item.text.length) { i += 1; j = 0; }
        setTimeout(tick, ch === '\n' ? 170 : 14);
      }
      tick();
    });
  }

  FS.ui = {
    esc: esc, raw: raw, html: html, money: money, size: size, date: date, dateTime: dateTime, qs: qs,
    paragraphs: paragraphs, pill: pill, card: card, gameTile: gameTile, creatorCard: creatorCard, cover: cover, toast: toast,
    priceText: priceText, scanText: scanText, plural: plural, typeInto: typeInto, calm: calm,
  };
})((window.FS = window.FS || {}));
