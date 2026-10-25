(function (FS) {
  'use strict';
  var html = FS.ui.html;
  FS.pages = FS.pages || {};

  // Only follow a "next" address that stays on this site.
  function safeNext(next) {
    return typeof next === 'string' && next.charAt(0) === '/' && next.charAt(1) !== '/' ? next : '/account';
  }

  function mountForm(el, ctx, submit) {
    var form = el.querySelector('form');
    var err = el.querySelector('#err');
    var button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      button.disabled = true;
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      submit(data).then(function (user) {
        ctx.state.user = user;
        ctx.refreshHeader();
        FS.ui.toast('Signed in as ' + user.username);
        ctx.navigate(safeNext(ctx.query.next));
      }, function (e2) {
        button.disabled = false;
        err.textContent = e2.message;
        var first = form.querySelector('input');
        if (first) first.focus();
      });
    });
  }

  FS.pages.signin = {
    render: function (ctx) {
      ctx.setTitle('Sign in - FileShelf');
      var next = ctx.query.next ? FS.ui.qs({ next: ctx.query.next }) : '';
      return Promise.resolve(html`
<section class="page-head"><div class="wrap narrow"><h1>Sign in</h1></div></section>
<section class="band band-flush"><div class="wrap narrow">
  <form class="form panel" novalidate>
    <p class="form-error" id="err" role="alert"></p>
    <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary" type="submit">Sign in</button>
    <p class="muted">New here? <a class="more" href="#/signup${next}">Create an account</a></p>
  </form>
</div></section>`);
    },
    mount: function (el, ctx) { mountForm(el, ctx, ctx.api.login); },
  };

  FS.pages.signup = {
    render: function (ctx) {
      ctx.setTitle('Sign up - FileShelf');
      var next = ctx.query.next ? FS.ui.qs({ next: ctx.query.next }) : '';
      return Promise.resolve(html`
<section class="page-head"><div class="wrap narrow"><h1>Create an account</h1><p class="lead">One account to download, save and publish.</p></div></section>
<section class="band band-flush"><div class="wrap narrow">
  <form class="form panel" novalidate>
    <p class="form-error" id="err" role="alert"></p>
    <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="username">Username</label><input class="input" id="username" name="username" autocomplete="username" minlength="3" maxlength="24" required><span class="hint">3 to 24 letters, numbers or underscores. People see this on your listings.</span></div>
    <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="10" required><span class="hint">At least 10 characters.</span></div>
    <button class="btn btn-primary" type="submit">Create account</button>
    <p class="muted">Already have an account? <a class="more" href="#/signin${next}">Sign in</a></p>
  </form>
</div></section>`);
    },
    mount: function (el, ctx) { mountForm(el, ctx, ctx.api.signup); },
  };
})((window.FS = window.FS || {}));
