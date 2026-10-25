// Talks to the server. The demo build swaps this for a browser-only version with the same methods.
(function (FS) {
  'use strict';

  function ApiError(message, status) {
    this.message = message;
    this.status = status;
  }
  ApiError.prototype = Object.create(Error.prototype);
  FS.ApiError = ApiError;

  function call(method, url, body) {
    var init = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(
      function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Try again.', res.status);
          return data;
        });
      },
      function () { throw new ApiError('Could not reach the server. Check your connection.', 0); },
    );
  }
  var get = function (u) { return call('GET', u); };
  var post = function (u, b) { return call('POST', u, b || {}); };
  var pick = function (key) { return function (d) { return d[key]; }; };
  var enc = encodeURIComponent;

  FS.realApi = {
    imageUrl: function (id) { return '/api/images/' + id; },
    config: function () { return get('/api/config'); },
    stats: function () { return get('/api/stats'); },
    me: function () { return get('/api/auth/me').then(pick('user')); },
    signup: function (b) { return post('/api/auth/signup', b).then(pick('user')); },
    login: function (b) { return post('/api/auth/login', b).then(pick('user')); },
    logout: function () { return post('/api/auth/logout'); },

    categories: function () { return get('/api/categories').then(pick('categories')); },
    games: function (p) { return get('/api/games' + FS.ui.qs(p || {})).then(pick('games')); },
    game: function (slug) { return get('/api/games/' + enc(slug)); },
    listings: function (p) { return get('/api/listings' + FS.ui.qs(p || {})); },
    listing: function (id) { return get('/api/listings/' + enc(id)).then(pick('listing')); },
    creators: function () { return get('/api/creators').then(pick('creators')); },
    creator: function (username) { return get('/api/creators/' + enc(username)); },

    myCreator: function () { return get('/api/me/creator').then(pick('profile')); },
    saveCreator: function (b) { return post('/api/me/creator', b); },
    myListings: function () { return get('/api/me/listings').then(pick('listings')); },
    updateListing: function (id, patch) { return call('PATCH', '/api/listings/' + enc(id), patch); },
    withdraw: function (id) { return post('/api/listings/' + enc(id) + '/withdraw'); },

    vault: function () { return get('/api/me/vault').then(pick('saved')); },
    saveToVault: function (id) { return post('/api/me/vault/' + enc(id)); },
    removeFromVault: function (id) { return call('DELETE', '/api/me/vault/' + enc(id)); },
    downloads: function () { return get('/api/me/downloads').then(pick('downloads')); },

    checkout: function (id) { return post('/api/listings/' + enc(id) + '/checkout'); },
    order: function (id) { return get('/api/orders/' + enc(id)).then(pick('order')); },
    mockPay: function (id) { return post('/api/orders/' + enc(id) + '/mock-pay'); },
    myOrders: function () { return get('/api/me/orders').then(pick('orders')); },
    mySales: function () { return get('/api/me/sales'); },
    connectPayouts: function () { return post('/api/me/payouts/connect'); },

    adminQueue: function () { return get('/api/admin/queue').then(pick('queue')); },
    adminApprove: function (id) { return post('/api/admin/listings/' + enc(id) + '/approve'); },
    adminReject: function (id, reason) { return post('/api/admin/listings/' + enc(id) + '/reject', { reason: reason }); },
    adminRemove: function (id, reason) { return post('/api/admin/listings/' + enc(id) + '/remove', { reason: reason }); },
    adminFeature: function (id, featured) { return post('/api/admin/listings/' + enc(id) + '/feature', { featured: !!featured }); },
    adminUsers: function (q) { return get('/api/admin/users' + FS.ui.qs({ q: q })); },
    adminSetRole: function (id, role) { return post('/api/admin/users/' + enc(id) + '/role', { role: role }); },
    adminAudit: function (offset) { return get('/api/admin/audit' + FS.ui.qs({ offset: offset || '' })); },
    adminAddGame: function (body) { return post('/api/admin/games', body); },
    adminEditGame: function (slug, body) { return call('PATCH', '/api/admin/games/' + enc(slug), body); },

    // Asks for a short-lived link, then lets the browser download it.
    startDownload: function (listingId, kind) {
      return post('/api/listings/' + enc(listingId) + '/download-link', { kind: kind || 'paid' }).then(function (d) {
        window.location.assign(d.url);
        return d;
      });
    },

    // Uploads with progress. files = { paid, free, images: [] }
    createListing: function (fields, files, onProgress) {
      return new Promise(function (resolve, reject) {
        var form = new FormData();
        Object.keys(fields).forEach(function (k) { form.set(k, fields[k]); });
        form.set('paid_file', files.paid);
        if (files.free) form.set('free_file', files.free);
        (files.images || []).forEach(function (f) { form.append('images', f); });
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/listings');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = function () {
          var data = {};
          try { data = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new ApiError(data.error || 'The upload failed. Try again.', xhr.status));
        };
        xhr.onerror = function () {
          reject(new ApiError('The upload was interrupted. Check your connection and try again.', 0));
        };
        xhr.send(form);
      });
    },
  };
})((window.FS = window.FS || {}));
