(function (FS) {
  'use strict';
  var html = FS.ui.html, size = FS.ui.size;
  FS.pages = FS.pages || {};

  var extOf = function (name) { var i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };

  function creatorSetup(ctx) {
    var u = ctx.state.user;
    return html`
<section class="page-head"><div class="wrap">
  <h1>Publish a utility</h1>
  <p class="lead">Set up a creator profile first. People see your display name and bio on your listings. A moderator reviews every listing before it goes live.</p>
</div></section>
<section class="band band-flush"><div class="wrap">
  <form class="form panel narrow-form" id="creator-form" novalidate>
    <p class="form-error" id="err" role="alert"></p>
    <div class="field"><label for="display_name">Display name</label><input class="input" id="display_name" name="display_name" maxlength="40" value="${u.username}" required><span class="hint">2 to 40 characters.</span></div>
    <div class="field"><label for="bio">About you (optional)</label><textarea class="textarea" id="bio" name="bio" maxlength="500"></textarea><span class="hint">Up to 500 characters.</span></div>
    <p class="muted">Before you publish, read the <a class="more" href="#/terms">content rules</a>. Only single-player utilities are allowed.</p>
    <div class="row-flex"><button class="btn btn-primary" type="submit">Create creator profile</button></div>
  </form>
</div></section>`;
  }

  FS.pages.sell = {
    render: function (ctx) {
      ctx.requireUser('/sell');
      if (!ctx.state.user.can_publish) {
        ctx.setTitle('Publish - FileShelf');
        return Promise.resolve(creatorSetup(ctx));
      }
      return Promise.all([ctx.api.games(), ctx.api.categories(), ctx.api.config()]).then(function (r) {
        var games = r[0], cats = r[1], cfg = r[2];
        var paid = cfg.payments !== 'off';
        ctx.setTitle('Publish - FileShelf');
        return html`
<section class="page-head"><div class="wrap">
  <h1>Add a listing</h1>
  <p class="lead">A moderator reviews each listing before it goes live, and again after any edit. ${paid ? 'FileShelf keeps ' + cfg.fee_percent + '% of each sale.' : 'Listings are free for now. Paid listings are not available yet.'}</p>
</div></section>
<section class="band band-flush"><div class="wrap">
  <form class="form panel narrow-form" id="sell-form" novalidate>
    <p class="form-error" id="err" role="alert"></p>
    <div class="field"><label for="title">Title</label><input class="input" id="title" name="title" maxlength="80" required></div>
    <div class="field-row">
      <div class="field"><label for="game">Game</label>
        <select class="select" id="game" name="game" required><option value="">Choose a game</option>${games.map(function (g) { return html`<option value="${g.slug}">${g.name}</option>`; })}</select></div>
      <div class="field"><label for="category">Category</label>
        <select class="select" id="category" name="category" required><option value="">Choose a category</option>${cats.map(function (c) { return html`<option value="${c.id}">${c.name}</option>`; })}</select></div>
    </div>
    ${paid ? html`<div class="field"><label for="price">Price</label><div class="money"><input class="input" id="price" name="price" inputmode="decimal" placeholder="Leave blank for free"></div>
        <span class="hint">Leave blank for a free listing, or enter ${FS.ui.money(cfg.min_price_pence)} to ${FS.ui.money(cfg.max_price_pence)}.</span></div>` : ''}
    <div class="field"><label for="summary">Short summary</label><input class="input" id="summary" name="summary" maxlength="160" required><span class="hint">Shown on listing cards. Up to 160 characters.</span></div>
    <div class="field"><label for="description">Description</label><textarea class="textarea" id="description" name="description" maxlength="5000" required></textarea><span class="hint">Say what it does, which game version you tested it on, how to install it and how to remove it.</span></div>
    <div class="field"><label for="features">Features</label><textarea class="textarea" id="features" name="features" placeholder="One feature per line"></textarea><span class="hint">One per line, up to 12.</span></div>
    <div class="field"><label for="version">Version</label><input class="input" id="version" name="version" value="1.0" maxlength="20"></div>

    <div class="field"><span class="label" id="paid-label">File people download</span>
      <div class="file-input"><input id="paid_file" name="paid_file" type="file" aria-labelledby="paid-label" required><span class="file-names" data-names="paid_file"></span></div>
      <span class="hint">Up to ${cfg.max_upload_mb} MB. Allowed: ${cfg.allowed_extensions.join(', ')}. Put executables inside a .zip.</span></div>
    ${paid ? html`<div class="field"><span class="label" id="free-label">Free version (optional)</span>
      <div class="file-input"><input id="free_file" name="free_file" type="file" aria-labelledby="free-label"><span class="file-names" data-names="free_file"></span></div>
      <span class="hint">Anyone can download this without paying. Only for paid listings.</span></div>` : ''}
    <div class="field"><span class="label" id="img-label">Images (optional)</span>
      <div class="file-input"><input id="images" name="images" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-labelledby="img-label"><span class="file-names" data-names="images"></span></div>
      <span class="hint">Up to ${cfg.max_images} PNG, JPG or WebP images, ${cfg.max_image_mb} MB each. The first is the cover.</span></div>

    <label class="checkline"><input type="checkbox" id="agree" name="agree" value="yes" required><span>I made this file or have permission to share it, and it follows the <a class="more" href="#/terms">content rules</a>.</span></label>
    <div class="progress" id="progress" hidden><i></i></div>
    <div class="row-flex"><button class="btn btn-primary" type="submit">Submit for review</button><a class="btn btn-line" href="#/account/listings">Cancel</a></div>
  </form>
</div></section>`;
      });
    },

    mount: function (el, ctx) {
      var setup = el.querySelector('#creator-form');
      if (setup) {
        var serr = el.querySelector('#err');
        setup.addEventListener('submit', function (e) {
          e.preventDefault();
          serr.textContent = '';
          var b = setup.querySelector('button[type="submit"]');
          b.disabled = true;
          ctx.api.saveCreator({ display_name: setup.display_name.value, bio: setup.bio.value }).then(function () {
            return ctx.api.me();
          }).then(function (u) {
            ctx.state.user = u;
            ctx.refreshHeader();
            FS.ui.toast('Creator profile created');
            ctx.reload();
          }, function (e2) { b.disabled = false; serr.textContent = e2.message; });
        });
        return;
      }
      var form = el.querySelector('#sell-form');
      var err = el.querySelector('#err');
      var bar = el.querySelector('#progress');
      var cfgPromise = ctx.api.config();

      form.querySelectorAll('input[type="file"]').forEach(function (input) {
        input.addEventListener('change', function () {
          var out = form.querySelector('[data-names="' + input.name + '"]');
          out.textContent = Array.prototype.map.call(input.files, function (f) { return f.name + ' (' + size(f.size) + ')'; }).join('\n');
        });
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.textContent = '';
        cfgPromise.then(function (cfg) {
          var paid = form.paid_file.files[0];
          var free = form.free_file ? form.free_file.files[0] : null;
          var images = Array.prototype.slice.call(form.images.files);
          var fields = {};
          ['title', 'game', 'category', 'price', 'summary', 'description', 'features', 'version'].forEach(function (k) { fields[k] = form[k] ? form[k].value : ''; });
          fields.agree = form.agree.checked ? 'yes' : 'no';

          var problem = null;
          if (!fields.title.trim()) problem = 'Enter a title.';
          else if (!fields.game) problem = 'Choose a game.';
          else if (!fields.category) problem = 'Choose a category.';
          else if (fields.price.trim() && !/^\d{1,4}(\.\d{1,2})?$/.test(fields.price.trim())) problem = 'Enter the price in pounds, for example 9.99, or leave it blank for free.';
          else if (!fields.summary.trim()) problem = 'Enter a short summary.';
          else if (!fields.description.trim()) problem = 'Enter a description.';
          else if (!paid) problem = 'Attach the file people will download.';
          else if (!form.agree.checked) problem = 'Confirm that you made this file or have permission to share it, and that it follows the content rules.';
          [paid, free].forEach(function (f) {
            if (problem || !f) return;
            if (cfg.allowed_extensions.indexOf(extOf(f.name)) < 0) {
              problem = (extOf(f.name) ? 'Files ending in ".' + extOf(f.name) + '" are not accepted.' : f.name + ' has no file extension.') +
                ' Put it in a .zip and upload that. Accepted: ' + cfg.allowed_extensions.join(', ') + '.';
            }
            else if (f.size > cfg.max_upload_mb * 1024 * 1024) problem = f.name + ' is larger than ' + cfg.max_upload_mb + ' MB.';
          });
          if (!problem && images.length > cfg.max_images) problem = 'Add at most ' + cfg.max_images + ' images.';
          images.forEach(function (f) {
            if (problem) return;
            if (['png', 'jpg', 'jpeg', 'webp'].indexOf(extOf(f.name)) < 0) problem = f.name + ' is not a PNG, JPG or WebP image.';
            else if (f.size > cfg.max_image_mb * 1024 * 1024) problem = f.name + ' is larger than ' + cfg.max_image_mb + ' MB.';
          });
          if (problem) { err.textContent = problem; err.scrollIntoView({ block: 'center' }); return; }

          var button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          bar.hidden = false;
          var fill = bar.querySelector('i');
          ctx.api.createListing(fields, { paid: paid, free: free, images: images }, function (p) {
            fill.style.width = Math.round(p * 100) + '%';
          }).then(function () {
            FS.ui.toast('Submitted for review');
            ctx.navigate('/account/listings');
          }, function (e2) {
            button.disabled = false;
            bar.hidden = true;
            fill.style.width = '0';
            err.textContent = e2.message;
            err.scrollIntoView({ block: 'center' });
          });
        });
      });
    },
  };
})((window.FS = window.FS || {}));
