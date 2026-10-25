(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  function rows(items) {
    return html`${items.map(function (it) {
      return html`<div class="help-row"><h2>${it[0]}</h2><div>${[].concat(it[1]).map(function (p) { return html`<p>${p}</p>`; })}</div></div>`;
    })}`;
  }

  function paymentsText(cfg) {
    if (cfg.payments === 'mock') return 'This site is running test payments. No card is charged and no money moves.';
    if (cfg.payments === 'stripe') return 'Payments are handled by Stripe, so FileShelf never sees your card details. Creators are paid after the platform fee of ' + cfg.fee_percent + '%.';
    return 'Everything on FileShelf is free for now. Paid listings will be added once a payment provider has been set up and tested.';
  }

  FS.pages.help = {
    render: function (ctx) {
      return ctx.api.config().then(function (cfg) {
        ctx.setTitle('Help - FileShelf');
        return html`
<section class="page-head"><div class="wrap"><h1>Help</h1><p class="lead">How FileShelf works, and what to check before you use a file.</p></div></section>
<section class="band band-flush"><div class="wrap">
${rows([
  ['Finding utilities', 'Browse by game or category, or use search. Every listing shows the game, the creator, the version and when it was last updated, so you can tell whether it suits the version of the game you have.'],
  ['Downloading', 'You need an account to download, which lets your Vault keep a history. Download links are private to you and stop working after five minutes. If one has expired, press Download again.'],
  ['Checking a file', [
    'Each listing shows the file size, a SHA-256 hash and the scan status. The hash lets you check that the file you received is the file that was uploaded.',
    '"Not scanned" means no scanner was used on that file. Where a file was scanned, the result is only what that scanner found. A scan cannot promise that a file is safe, so keep a backup of your saves and only use files from creators you trust.',
  ]],
  ['My Vault', 'Save listings from their pages. Your Vault also lists the files you downloaded here. FileShelf cannot see your computer, so it never says that something is installed.'],
  ['Intel', 'Intel lists the games FileShelf covers, with details such as developer and release date. The details were entered by hand, and the game\'s Steam page is the reference. Player counts appear only when a Steam data source is set up. Until then Intel says they are not available.'],
  ['Publishing', 'Create a creator profile from the Sell page, then submit a listing with your file, a description and optional images. A moderator reviews it before it goes live. Editing a live listing sends it back for review. You can withdraw a listing whenever you like.'],
  ['Payments', paymentsText(cfg)],
  ['Contact', cfg.contact_email
    ? html`You can reach the people who run this site at <a class="more" href="mailto:${cfg.contact_email}">${cfg.contact_email}</a>.`
    : 'Contact details have not been set up on this site yet.'],
])}
</div></section>`;
      });
    },
  };

  FS.pages.terms = {
    render: function (ctx) {
      return ctx.api.config().then(function (cfg) {
        ctx.setTitle('Content rules - FileShelf');
        return html`
<section class="page-head"><div class="wrap"><h1>Content rules</h1><p class="lead">What can be published on FileShelf, and what is removed.</p></div></section>
<section class="band band-flush"><div class="wrap">
${rows([
  ['What is allowed', 'Utilities for single-player PC games: trainers, save editors and save tools, mods and mod packs, configuration files and presets, and performance or accessibility tools. Everything must be lawful and made for a specific game.'],
  ['What is not allowed', [
    'Malware of any kind.',
    'Tools that steal passwords or other credentials, or take over accounts.',
    'Tools that give an advantage in competitive multiplayer games, or that get around anti-cheat protection.',
    'Stolen, leaked or pirated content, including cracked game files.',
    'Anything unlawful.',
  ]],
  ['Your files', 'Only upload files you made or have permission to share. Say what the file does, which game version you tested it on, and how to install and remove it.'],
  ['Review', 'A person reviews every listing before it goes live, and again after any edit. A reviewer can reject a listing with a reason, or remove a live listing. People who already downloaded a removed listing keep the file but cannot download it again. A moderator cannot approve their own listing.'],
  ['Scans and hashes', 'Where a scanner is set up, files are scanned when they are uploaded and the result is shown on the listing. A scan cannot find everything and is not a guarantee. Reviewers also check files, but they cannot promise that a file is safe.'],
  ['Fees', cfg.payments === 'off'
    ? 'There are no fees while everything is free. Fees will be set out here before paid listings are switched on.'
    : 'FileShelf keeps ' + cfg.fee_percent + '% of each sale.'],
  ['Reporting a problem', 'There is no report button yet. If you find a listing that breaks these rules, contact the people who run this site (see Help) and include a link to the listing.'],
])}
</div></section>`;
      });
    },
  };

  FS.pages.notfound = {
    render: function (ctx) {
      ctx.setTitle('Not found - FileShelf');
      return Promise.resolve(html`
<section class="page-head"><div class="wrap"><h1>Page not found</h1><p class="lead">That page does not exist.</p>
<p><a class="btn btn-primary" href="#/">Go to the home page</a></p></div></section>`);
    },
  };
})((window.FS = window.FS || {}));
