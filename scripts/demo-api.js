// Browser-only stand-in for the server, used by the demo build. It has the same methods as FS.realApi
// but keeps everything in this browser (localStorage when allowed, memory otherwise).
// It exists to try the screens out. It has no real security: do not put real passwords into it.
// Everything it starts with is demo data and is labelled that way on screen. The games are the same
// starter list the real server uses (the build script copies it in as FS.starterGames and FS.categories).
(function (FS) {
  'use strict';

  var KEY = 'fileshelf-demo-v2';
  var EXTS = ['zip', '7z', 'rar', 'gz', 'tar', 'pdf', 'txt', 'md', 'json', 'csv', 'xlsx', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp'];
  var PASSWORD = 'placeholder-password';
  var ROLES = ['user', 'creator', 'moderator', 'admin'];
  var S = null;

  var ApiError = FS.ApiError || function (message, status) { this.message = message; this.status = status; };
  FS.ApiError = ApiError;
  ApiError.prototype = Object.create(Error.prototype);

  function fail(status, message) { return Promise.reject(new ApiError(message, status)); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function ok(v) { return Promise.resolve(copy(v)); }
  function id(p) { return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function hash64(seed) {
    var h = 2166136261, out = '';
    for (var i = 0; out.length < 64; i++) {
      h ^= seed.charCodeAt(i % seed.length) + i;
      h = Math.imul(h, 16777619) >>> 0;
      out += ('00000000' + h.toString(16)).slice(-8);
    }
    return out.slice(0, 64);
  }

  // ---- Starting data ----
  var CATEGORIES = (FS.categories || []).map(function (c, i) { return { id: c[0], name: c[1], description: c[2], position: c[3] || i + 1 }; });

  var DEMO = [
    ['Demo: Save backup helper', 'stardew-valley', 'save-tools', 'Copies the save folder to a dated backup before each session.', ['Dated backups', 'One-step restore', 'Keeps the last ten copies']],
    ['Demo: Texture pack sampler', 'skyrim-special-edition', 'mods', 'A small set of texture replacements.', ['Four texture sets', 'Load order notes', 'Removal steps']],
    ['Demo: Controller layout preset', 'elden-ring', 'configs', 'An alternative button layout for gamepads.', ['Two layouts', 'Left-handed option', 'Import steps']],
    ['Demo: Frame pacing settings', 'cyberpunk-2077', 'utilities', 'A settings file aimed at steadier frame times.', ['Three quality tiers', 'Notes on each setting', 'Easy to undo']],
    ['Demo: Larger subtitle preset', 'baldurs-gate-3', 'utilities', 'Bigger, higher-contrast subtitles.', ['Three sizes', 'High-contrast option', 'Install notes']],
    ['Demo: Quest log notes', 'the-witcher-3', 'other', 'A printable checklist of side quests.', ['By region', 'Spoiler-free headings', 'PDF and text']],
    ['Demo: Settlement layout tweaks', 'fallout-4', 'mods', 'Small changes to how settlements lay out.', ['Snap points', 'Extra decorations', 'Works with the base game']],
    ['Demo: Run statistics viewer', 'hades', 'other', 'Reads a save file and shows run statistics.', ['Per-run table', 'Export to CSV', 'Read-only']],
  ];

  function seed() {
    var now = Date.now();
    var games = (FS.starterGames || []).map(function (g) {
      var out = copy(g);
      out.metadata_source = 'manual';
      out.metadata_updated_at = now;
      out.official_url = out.official_url || null;
      return out;
    });
    var bio = 'Demo account. It is not a real creator.';
    var users = [
      { id: 'u_admin', email: 'admin@fileshelf.test', username: 'demo_admin', role: 'admin', password: PASSWORD, created_at: now - 9 * 86400000 },
      { id: 'u_mod', email: 'moderator@fileshelf.test', username: 'demo_moderator', role: 'moderator', password: PASSWORD, created_at: now - 9 * 86400000 },
      { id: 'u_c1', email: 'creator1@fileshelf.test', username: 'demo_creator_one', role: 'creator', password: PASSWORD, created_at: now - 8 * 86400000 },
      { id: 'u_c2', email: 'creator2@fileshelf.test', username: 'demo_creator_two', role: 'creator', password: PASSWORD, created_at: now - 8 * 86400000 },
      { id: 'u_m', email: 'member@fileshelf.test', username: 'demo_member', role: 'user', password: PASSWORD, created_at: now - 7 * 86400000 },
    ];
    var profiles = [
      { user_id: 'u_c1', display_name: 'Demo Creator One', bio: bio, created_at: now - 8 * 86400000 },
      { user_id: 'u_c2', display_name: 'Demo Creator Two', bio: bio, created_at: now - 8 * 86400000 },
    ];
    var listings = DEMO.map(function (row, i) {
      var n = i + 1;
      return {
        id: 'l_' + n,
        seller_id: i % 2 ? 'u_c2' : 'u_c1',
        game_slug: row[1],
        category_id: row[2],
        title: row[0],
        summary: row[3],
        description: row[3] + '\n\nThis is demo data so the site has something to show. The file attached to it does nothing.',
        features: row[4],
        version: '1.0',
        price_pence: 0,
        status: i === 7 ? 'pending' : 'approved',
        reject_reason: null,
        featured: i === 0 || i === 3,
        paid_file: { name: 'demo-' + n + '.zip', size: 40000 + n * 1300, sha256: hash64('paid' + n), scan_status: 'unscanned' },
        free_file: null,
        images: [],
        created_at: now - i * 3600000,
        updated_at: now - i * 3600000,
      };
    });
    return {
      games: games, users: users, profiles: profiles, listings: listings,
      saved: [], downloads: [], audit: [], images: {}, session: null,
    };
  }

  // ---- Storage ----
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { S = JSON.parse(raw); return; }
    } catch (e) {}
    S = seed();
  }
  load();

  // ---- Lookups ----
  var userById = function (x) { return S.users.filter(function (u) { return u.id === x; })[0] || null; };
  var userByName = function (x) { return S.users.filter(function (u) { return u.username.toLowerCase() === String(x).toLowerCase(); })[0] || null; };
  var gameBySlug = function (x) { return S.games.filter(function (g) { return g.slug === x; })[0] || null; };
  var listingById = function (x) { return S.listings.filter(function (l) { return l.id === x; })[0] || null; };
  var profileOf = function (userId) { return S.profiles.filter(function (p) { return p.user_id === userId; })[0] || null; };
  var categoryById = function (x) { return CATEGORIES.filter(function (c) { return c.id === x; })[0] || null; };
  var current = function () { return S.session ? userById(S.session) : null; };

  var isModerator = function (u) { return !!u && (u.role === 'moderator' || u.role === 'admin'); };
  var isAdmin = function (u) { return !!u && u.role === 'admin'; };
  var canPublish = function (u) { return !!u && ROLES.indexOf(u.role) >= 1; };

  function publicUser(u) {
    return {
      id: u.id, username: u.username, email: u.email, role: u.role,
      can_publish: canPublish(u), is_moderator: isModerator(u), is_admin: isAdmin(u), payouts_enabled: false,
    };
  }
  function needUser() { return current(); }
  function logAudit(actor, action, targetType, targetId, detail) {
    S.audit.push({
      id: S.audit.length + 1, actor_name: actor.username, action: action, target_type: targetType,
      target_id: targetId, detail: detail || null, created_at: Date.now(),
    });
  }
  function approvedCount(slug) {
    return S.listings.filter(function (l) { return l.game_slug === slug && l.status === 'approved'; }).length;
  }

  function card(l) {
    var g = gameBySlug(l.game_slug);
    var seller = userById(l.seller_id);
    var p = profileOf(l.seller_id);
    var c = categoryById(l.category_id);
    return {
      id: l.id, title: l.title, summary: l.summary, price_pence: l.price_pence, is_free: l.price_pence === 0,
      version: l.version, status: l.status, reject_reason: l.reject_reason || null, featured: !!l.featured, is_demo: true,
      created_at: l.created_at, updated_at: l.updated_at, has_free: !!l.free_file, cover_id: l.images[0] || null,
      seller: seller.username, seller_display: p ? p.display_name : seller.username,
      category: c ? { id: c.id, name: c.name } : null,
      game: { slug: g.slug, name: g.name, code: g.code, tint: g.tint },
    };
  }
  function gameRow(g) {
    return {
      slug: g.slug, name: g.name, code: g.code, tint: g.tint, steam_app_id: g.steam_app_id || null,
      developer: g.developer || null, publisher: g.publisher || null, release_date: g.release_date || null,
      genres: g.genres || null, listings: approvedCount(g.slug),
    };
  }
  function publicProfile(userId) {
    var u = userById(userId), p = profileOf(userId);
    return {
      username: u.username, display_name: p.display_name, bio: p.bio, joined: p.created_at,
      listings: S.listings.filter(function (l) { return l.seller_id === userId && l.status === 'approved'; }).length,
    };
  }
  function ensureProfile(u) {
    if (profileOf(u.id)) return;
    S.profiles.push({ user_id: u.id, display_name: u.username, bio: '', created_at: Date.now() });
  }

  // The demo has no payments, so a file can be downloaded while its listing is live.
  function canDownload(u, l) {
    if (!u) return false;
    if (u.id === l.seller_id || isModerator(u)) return true;
    return l.status === 'approved';
  }

  // ---- Validation (same rules as the server) ----
  function text(v, label, min, max) {
    var s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
    if (s.length < min) throw new ApiError(label + ' needs at least ' + min + ' characters.', 400);
    if (s.length > max) throw new ApiError(label + ' must be ' + max + ' characters or fewer.', 400);
    return s;
  }
  function priceOf(v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '') return 0;
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) throw new ApiError('Enter the price in pounds, for example 12.50, or leave it blank for a free listing.', 400);
    if (Number(s) === 0) return 0;
    throw new ApiError('Paid listings are not available yet. Leave the price blank to publish this listing for free.', 400);
  }
  function features(v) {
    var list = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
    list = list.map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (list.length > 12) throw new ApiError('Add at most 12 features.', 400);
    if (list.some(function (s) { return s.length > 120; })) throw new ApiError('Each feature must be 120 characters or fewer.', 400);
    return list;
  }
  function category(v) {
    var c = categoryById(String(v || ''));
    if (!c) throw new ApiError('Choose a category.', 400);
    return c.id;
  }
  function extOf(name) { var i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }

  function gameDetails(b) {
    var out = {};
    function str(key, max) {
      if (b[key] === undefined) return;
      var v = String(b[key] == null ? '' : b[key]).replace(/\r\n?/g, '\n').trim();
      if (v.length > max) throw new ApiError(key.replace('_', ' ') + ' must be ' + max + ' characters or fewer.', 400);
      out[key] = v || null;
    }
    str('developer', 80); str('publisher', 80); str('genres', 100); str('description', 600);
    if (b.release_date !== undefined) {
      var d = String(b.release_date == null ? '' : b.release_date).trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ApiError('Enter the release date as YYYY-MM-DD.', 400);
      out.release_date = d || null;
    }
    if (b.steam_app_id !== undefined) {
      var a = String(b.steam_app_id == null ? '' : b.steam_app_id).trim();
      if (a && !/^\d{1,10}$/.test(a)) throw new ApiError('The Steam App ID is a whole number.', 400);
      out.steam_app_id = a ? Number(a) : null;
    }
    if (b.official_url !== undefined) {
      var u = String(b.official_url == null ? '' : b.official_url).trim();
      if (u && !/^https:\/\/[^\s]{3,300}$/.test(u)) throw new ApiError('The official link must start with https://', 400);
      out.official_url = u || null;
    }
    return out;
  }

  function downscale(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve(null); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(null); };
        img.onload = function () {
          var max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          try { resolve(c.toDataURL('image/jpeg', 0.8)); } catch (e) { resolve(null); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wrap(fn) {
    try { return fn(); } catch (e) { return Promise.reject(e); }
  }
  function needModerator() {
    var u = current();
    if (!u) return new ApiError('Sign in first.', 401);
    if (!isModerator(u)) return new ApiError('This is for moderators and admins only.', 403);
    return null;
  }
  function needAdmin() {
    var u = current();
    if (!u) return new ApiError('Sign in first.', 401);
    if (!isAdmin(u)) return new ApiError('This is for admins only.', 403);
    return null;
  }
  function reasonOf(r) {
    r = String(r || '').trim();
    if (r.length < 3 || r.length > 500) throw new ApiError('Give a reason of 3 to 500 characters.', 400);
    return r;
  }
  var notFound = function () { return fail(404, 'Not found.'); };

  FS.demoApi = {
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      S = seed();
      save();
    },
    imageUrl: function (x) { return S.images[x] || ''; },

    config: function () {
      return ok({
        payments: 'off', fee_percent: 10, max_upload_mb: 200, max_image_mb: 5, max_images: 6,
        min_price_pence: 99, max_price_pence: 50000, allowed_extensions: EXTS,
        demo_data: true, contact_email: '', player_counts: false,
      });
    },
    stats: function () {
      var live = S.listings.filter(function (l) { return l.status === 'approved'; });
      var sellers = {};
      live.forEach(function (l) { sellers[l.seller_id] = 1; });
      return ok({ listings: live.length, games: S.games.length, sellers: Object.keys(sellers).length });
    },

    // ---- Accounts ----
    me: function () { var u = current(); return ok(u ? publicUser(u) : null); },
    signup: function (b) {
      return wrap(function () {
        var email = String(b.email || '').trim().toLowerCase();
        var username = String(b.username || '').trim();
        var password = String(b.password || '');
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return fail(400, 'Enter a valid email address.');
        if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return fail(400, 'Usernames are 3 to 24 characters: letters, numbers and underscores.');
        if (password.length < 10) return fail(400, 'Passwords need at least 10 characters.');
        if (S.users.some(function (u) { return u.email === email || u.username.toLowerCase() === username.toLowerCase(); })) {
          return fail(409, 'That email or username is already taken.');
        }
        var u = { id: id('u_'), email: email, username: username, role: 'user', password: password, created_at: Date.now() };
        S.users.push(u);
        S.session = u.id;
        save();
        return ok(publicUser(u));
      });
    },
    login: function (b) {
      var email = String(b.email || '').trim().toLowerCase();
      var u = S.users.filter(function (x) { return x.email === email; })[0];
      if (!u || u.password !== String(b.password || '')) return fail(401, 'Email or password is incorrect.');
      S.session = u.id;
      save();
      return ok(publicUser(u));
    },
    logout: function () { S.session = null; save(); return ok({ ok: true }); },

    // ---- Browsing ----
    categories: function () {
      return ok(CATEGORIES.map(function (c) {
        return {
          id: c.id, name: c.name, description: c.description,
          listings: S.listings.filter(function (l) { return l.category_id === c.id && l.status === 'approved'; }).length,
        };
      }));
    },
    games: function (p) {
      p = p || {};
      var rows = S.games.slice();
      var q = String(p.q || '').trim().toLowerCase();
      if (q) {
        rows = rows.filter(function (g) {
          return [g.name, g.developer, g.genres].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; }) ||
            String(g.steam_app_id || '') === q;
        });
      }
      var byName = function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; };
      rows.sort({
        released: function (a, b) { return String(b.release_date || '') < String(a.release_date || '') ? -1 : String(b.release_date || '') > String(a.release_date || '') ? 1 : byName(a, b); },
        listings: function (a, b) { return approvedCount(b.slug) - approvedCount(a.slug) || byName(a, b); },
      }[p.sort] || byName);
      return ok(rows.map(gameRow));
    },
    game: function (slug) {
      var g = gameBySlug(slug);
      if (!g) return fail(404, 'Game not found.');
      var row = gameRow(g);
      row.description = g.description || null;
      row.official_url = g.official_url || null;
      row.metadata_source = g.metadata_source || 'manual';
      row.metadata_updated_at = g.metadata_updated_at || null;
      row.store_url = g.steam_app_id ? 'https://store.steampowered.com/app/' + g.steam_app_id + '/' : null;
      return ok({ game: row, players: { status: 'not_configured', current: null, updated_at: null } });
    },
    listings: function (p) {
      p = p || {};
      var rows = S.listings.filter(function (l) { return l.status === 'approved'; });
      if (p.game) rows = rows.filter(function (l) { return l.game_slug === p.game; });
      if (p.category) rows = rows.filter(function (l) { return l.category_id === p.category; });
      if (p.free === '1') rows = rows.filter(function (l) { return l.price_pence === 0 || !!l.free_file; });
      if (p.featured === '1') rows = rows.filter(function (l) { return l.featured; });
      if (p.q) {
        var q = String(p.q).toLowerCase();
        rows = rows.filter(function (l) {
          return l.title.toLowerCase().indexOf(q) >= 0 || l.summary.toLowerCase().indexOf(q) >= 0 ||
            gameBySlug(l.game_slug).name.toLowerCase().indexOf(q) >= 0;
        });
      }
      rows.sort({
        price_asc: function (a, b) { return a.price_pence - b.price_pence || b.created_at - a.created_at; },
        price_desc: function (a, b) { return b.price_pence - a.price_pence || b.created_at - a.created_at; },
        updated: function (a, b) { return b.updated_at - a.updated_at; },
      }[p.sort] || function (a, b) { return b.created_at - a.created_at; });
      var limit = Math.min(Math.max(parseInt(p.limit, 10) || 24, 1), 48);
      var offset = Math.max(parseInt(p.offset, 10) || 0, 0);
      return ok({ listings: rows.slice(offset, offset + limit).map(card), total: rows.length });
    },
    listing: function (x) {
      var l = listingById(x);
      var u = current();
      var staff = !!(l && u && (u.id === l.seller_id || isModerator(u)));
      if (!l || (l.status !== 'approved' && !staff)) return fail(404, 'Listing not found.');
      var out = card(l);
      out.description = l.description;
      out.features = l.features;
      out.images = l.images;
      out.paid_file = l.paid_file;
      out.free_file = l.free_file;
      out.viewer = {
        is_seller: !!u && u.id === l.seller_id,
        is_admin: isAdmin(u),
        is_moderator: isModerator(u),
        owned: false,
        saved: !!u && S.saved.some(function (s) { return s.user_id === u.id && s.listing_id === l.id; }),
      };
      return ok(out);
    },
    creators: function () {
      var rows = S.profiles.map(function (p) { return publicProfile(p.user_id); })
        .filter(function (p) { return p.listings > 0; });
      var latest = function (name) {
        var u = userByName(name);
        return S.listings.filter(function (l) { return l.seller_id === u.id && l.status === 'approved'; })
          .reduce(function (n, l) { return Math.max(n, l.updated_at); }, 0);
      };
      rows.sort(function (a, b) { return latest(b.username) - latest(a.username); });
      return ok(rows);
    },
    creator: function (username) {
      var u = userByName(username);
      if (!u || !profileOf(u.id)) return fail(404, 'Creator not found.');
      var rows = S.listings.filter(function (l) { return l.seller_id === u.id && l.status === 'approved'; })
        .sort(function (a, b) { return b.updated_at - a.updated_at; });
      return ok({ creator: publicProfile(u.id), listings: rows.map(card) });
    },

    // ---- Creator profile and publishing ----
    myCreator: function () {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      return ok(profileOf(u.id) ? publicProfile(u.id) : null);
    },
    saveCreator: function (b) {
      return wrap(function () {
        var u = needUser();
        if (!u) return fail(401, 'Sign in first.');
        var name = String(b.display_name == null ? '' : b.display_name).replace(/\s+/g, ' ').trim();
        var bio = String(b.bio == null ? '' : b.bio).replace(/\r\n?/g, '\n').trim();
        if (name.length < 2 || name.length > 40) return fail(400, 'The display name needs 2 to 40 characters.');
        if (/[\u0000-\u001f\u007f<>]/.test(name)) return fail(400, 'The display name cannot contain those characters.');
        if (bio.length > 500) return fail(400, 'The bio must be 500 characters or fewer.');
        var p = profileOf(u.id);
        if (p) { p.display_name = name; p.bio = bio; }
        else S.profiles.push({ user_id: u.id, display_name: name, bio: bio, created_at: Date.now() });
        if (u.role === 'user') {
          u.role = 'creator';
          logAudit(u, 'creator_signup', 'user', u.id);
        }
        save();
        return ok({ profile: { username: u.username, display_name: name, bio: bio }, role: u.role });
      });
    },
    myListings: function () {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      return ok(S.listings.filter(function (l) { return l.seller_id === u.id; })
        .sort(function (a, b) { return b.created_at - a.created_at; })
        .map(function (l) {
          var c = card(l);
          c.sales = 0;
          c.downloads = S.downloads.filter(function (d) { return d.listing_id === l.id; }).length;
          return c;
        }));
    },
    createListing: function (fields, files, onProgress) {
      return new Promise(function (resolve, reject) {
        var u = needUser();
        if (!u) return reject(new ApiError('Sign in first.', 401));
        if (!canPublish(u)) return reject(new ApiError('Set up a creator profile before you publish.', 403));
        var l;
        try {
          var g = gameBySlug(String(fields.game || ''));
          var price = priceOf(fields.price);
          l = {
            id: id('l_'), seller_id: u.id,
            title: text(fields.title, 'The title', 3, 80),
            summary: text(fields.summary, 'The summary', 3, 160),
            description: text(fields.description, 'The description', 3, 5000),
            features: features(fields.features),
            version: text(fields.version || '1.0', 'The version', 1, 20),
            price_pence: price,
            category_id: category(fields.category),
            status: 'pending', reject_reason: null, featured: false, images: [], free_file: null,
            created_at: Date.now(), updated_at: Date.now(),
          };
          if (!g) throw new ApiError('Choose a game.', 400);
          l.game_slug = g.slug;
          if (!files.paid) throw new ApiError('Attach the file people will download.', 400);
          if (String(fields.agree) !== 'yes') throw new ApiError('Confirm that you made this file or have permission to share it, and that it follows the rules.', 400);
          if (EXTS.indexOf(extOf(files.paid.name)) < 0) throw new ApiError('".' + extOf(files.paid.name) + '" files are not accepted.', 400);
        } catch (e) { return reject(e); }

        l.paid_file = { name: files.paid.name, size: files.paid.size, sha256: hash64(files.paid.name + files.paid.size + l.created_at), scan_status: 'unscanned' };

        var step = 0;
        var timer = setInterval(function () {
          step += 1;
          if (onProgress) onProgress(Math.min(step / 8, 1));
          if (step < 8) return;
          clearInterval(timer);
          Promise.all((files.images || []).slice(0, 6).map(downscale)).then(function (urls) {
            urls.forEach(function (url) {
              if (!url) return;
              var iid = id('i_');
              S.images[iid] = url;
              l.images.push(iid);
            });
            ensureProfile(u);
            S.listings.push(l);
            save();
            resolve({ id: l.id, status: 'pending' });
          });
        }, 90);
      });
    },
    updateListing: function (x, patch) {
      return wrap(function () {
        var u = needUser();
        var l = listingById(x);
        if (!u || !l || l.seller_id !== u.id) return fail(404, 'Listing not found.');
        if (l.status === 'withdrawn' || l.status === 'removed') return fail(409, 'This listing is no longer active and cannot be edited.');
        var next = {};
        if (patch.title !== undefined) next.title = text(patch.title, 'The title', 3, 80);
        if (patch.summary !== undefined) next.summary = text(patch.summary, 'The summary', 3, 160);
        if (patch.description !== undefined) next.description = text(patch.description, 'The description', 3, 5000);
        if (patch.features !== undefined) next.features = features(patch.features);
        if (patch.version !== undefined) next.version = text(patch.version || '1.0', 'The version', 1, 20);
        if (patch.price !== undefined) next.price_pence = priceOf(patch.price);
        if (patch.category !== undefined) next.category_id = category(patch.category);
        if (!Object.keys(next).length) return fail(400, 'Nothing to change.');
        Object.keys(next).forEach(function (k) { l[k] = next[k]; });
        l.status = 'pending';
        l.reject_reason = null;
        l.featured = false;
        l.updated_at = Date.now();
        save();
        return ok({ id: l.id, status: 'pending' });
      });
    },
    withdraw: function (x) {
      var u = needUser();
      var l = listingById(x);
      if (!u || !l || l.seller_id !== u.id || ['pending', 'approved', 'rejected'].indexOf(l.status) < 0) return fail(404, 'Listing not found.');
      l.status = 'withdrawn';
      l.featured = false;
      l.updated_at = Date.now();
      save();
      return ok({ id: l.id, status: 'withdrawn' });
    },

    // ---- Vault ----
    vault: function () {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      var rows = S.saved.filter(function (s) { return s.user_id === u.id; })
        .sort(function (a, b) { return b.created_at - a.created_at; })
        .map(function (s) {
          var l = listingById(s.listing_id);
          var c = card(l);
          var last = S.downloads.filter(function (d) { return d.user_id === u.id && d.listing_id === l.id; })
            .reduce(function (n, d) { return Math.max(n, d.created_at); }, 0);
          c.saved_at = s.created_at;
          c.available = l.status === 'approved';
          c.can_download = c.available;
          c.last_downloaded_at = last || null;
          return c;
        });
      return ok(rows);
    },
    saveToVault: function (x) {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      var l = listingById(x);
      if (!l || l.status !== 'approved') return fail(404, 'Listing not found.');
      if (!S.saved.some(function (s) { return s.user_id === u.id && s.listing_id === l.id; })) {
        S.saved.push({ user_id: u.id, listing_id: l.id, created_at: Date.now() });
        save();
      }
      return ok({ id: l.id, saved: true });
    },
    removeFromVault: function (x) {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      S.saved = S.saved.filter(function (s) { return !(s.user_id === u.id && s.listing_id === x); });
      save();
      return ok({ id: x, saved: false });
    },
    downloads: function () {
      var u = needUser();
      if (!u) return fail(401, 'Sign in first.');
      return ok(S.downloads.filter(function (d) { return d.user_id === u.id; })
        .sort(function (a, b) { return b.created_at - a.created_at; }).slice(0, 100)
        .map(function (d) {
          var l = listingById(d.listing_id);
          return {
            id: d.id, created_at: d.created_at, file_name: d.file_name, size: d.size, sha256: d.sha256,
            listing_id: l ? l.id : null, title: l ? l.title : null, version: l ? l.version : null, listing_status: l ? l.status : null,
          };
        }));
    },

    // ---- Payments are off in the demo, as they are on a new site ----
    checkout: notFound, order: notFound, mockPay: notFound, myOrders: notFound, mySales: notFound, connectPayouts: notFound,

    // The demo has no real files, so a download only checks that it would be allowed and records it.
    startDownload: function (listingId, kind) {
      var u = current();
      var l = listingById(listingId);
      if (!l) return fail(404, 'Listing not found.');
      if (kind === 'free') return fail(404, 'There is no free file for this listing.');
      if (!u) return fail(401, 'Sign in to download this file.');
      if (!canDownload(u, l)) return fail(404, l.status === 'removed' ? 'This listing has been removed.' : 'Listing not found.');
      S.downloads.push({
        id: S.downloads.length + 1, user_id: u.id, listing_id: l.id, created_at: Date.now(),
        file_name: l.paid_file.name, size: l.paid_file.size, sha256: l.paid_file.sha256,
      });
      save();
      return ok({ demo: true });
    },

    // ---- Moderation and administration ----
    adminQueue: function () {
      var e = needModerator();
      if (e) return Promise.reject(e);
      return ok(S.listings.filter(function (l) { return l.status === 'pending'; })
        .sort(function (a, b) { return a.created_at - b.created_at; })
        .map(function (l) {
          var s = userById(l.seller_id), c = categoryById(l.category_id);
          return {
            id: l.id, title: l.title, summary: l.summary, description: l.description, features: l.features,
            price_pence: l.price_pence, version: l.version, created_at: l.created_at, game_name: gameBySlug(l.game_slug).name,
            category_name: c ? c.name : null, seller: s.username, seller_email: s.email,
            paid_name: l.paid_file.name, paid_size: l.paid_file.size, paid_sha256: l.paid_file.sha256, paid_scan: l.paid_file.scan_status,
            free_name: l.free_file ? l.free_file.name : null, free_size: l.free_file ? l.free_file.size : null,
            image_count: l.images.length,
          };
        }));
    },
    adminApprove: function (x) {
      var e = needModerator();
      if (e) return Promise.reject(e);
      var u = current(), l = listingById(x);
      if (!l || l.status !== 'pending') return fail(409, 'Only listings waiting for review can be approved.');
      if (l.seller_id === u.id && !isAdmin(u)) return fail(403, 'You cannot approve your own listing. Ask another moderator.');
      l.status = 'approved';
      l.reject_reason = null;
      l.updated_at = Date.now();
      logAudit(u, 'listing_approve', 'listing', l.id, { title: l.title });
      save();
      return ok({ id: l.id, status: 'approved' });
    },
    adminReject: function (x, reason) {
      return wrap(function () {
        var e = needModerator();
        if (e) return Promise.reject(e);
        var u = current(), l = listingById(x);
        reason = reasonOf(reason);
        if (!l || l.status !== 'pending') return fail(409, 'Only listings waiting for review can be rejected.');
        l.status = 'rejected';
        l.reject_reason = reason;
        l.updated_at = Date.now();
        logAudit(u, 'listing_reject', 'listing', l.id, { title: l.title, reason: reason });
        save();
        return ok({ id: l.id, status: 'rejected' });
      });
    },
    adminRemove: function (x, reason) {
      return wrap(function () {
        var e = needModerator();
        if (e) return Promise.reject(e);
        var u = current(), l = listingById(x);
        reason = reasonOf(reason);
        if (!l || l.status === 'removed') return fail(404, 'Listing not found.');
        l.status = 'removed';
        l.featured = false;
        l.reject_reason = reason;
        l.updated_at = Date.now();
        logAudit(u, 'listing_remove', 'listing', l.id, { title: l.title, reason: reason });
        save();
        return ok({ id: l.id, status: 'removed' });
      });
    },
    adminFeature: function (x, featured) {
      var e = needAdmin();
      if (e) return Promise.reject(e);
      var u = current(), l = listingById(x);
      if (!l || l.status !== 'approved') return fail(409, 'Only live listings can be featured.');
      l.featured = !!featured;
      logAudit(u, featured ? 'listing_feature' : 'listing_unfeature', 'listing', l.id, { title: l.title });
      save();
      return ok({ id: l.id, featured: !!featured });
    },
    adminUsers: function (q) {
      var e = needAdmin();
      if (e) return Promise.reject(e);
      q = String(q || '').trim().toLowerCase();
      var rows = S.users.filter(function (u) { return !q || u.username.toLowerCase().indexOf(q) >= 0 || u.email.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return b.created_at - a.created_at; }).slice(0, 100)
        .map(function (u) {
          return {
            id: u.id, username: u.username, email: u.email, role: u.role, is_demo: u.email.slice(-13) === '@fileshelf.test',
            created_at: u.created_at, listings: S.listings.filter(function (l) { return l.seller_id === u.id; }).length,
          };
        });
      return ok({ users: rows, roles: ROLES });
    },
    adminSetRole: function (x, role) {
      var e = needAdmin();
      if (e) return Promise.reject(e);
      var u = current(), target = userById(x);
      role = String(role || '');
      if (ROLES.indexOf(role) < 0) return fail(400, 'The role must be one of: ' + ROLES.join(', ') + '.');
      if (x === u.id) return fail(400, 'You cannot change your own role. Ask another admin.');
      if (!target) return fail(404, 'User not found.');
      if (target.role !== role) {
        var from = target.role;
        target.role = role;
        if (role !== 'user') ensureProfile(target);
        logAudit(u, 'role_change', 'user', target.id, { username: target.username, from: from, to: role });
        save();
      }
      return ok({ id: x, role: role });
    },
    adminAudit: function (offset) {
      var e = needAdmin();
      if (e) return Promise.reject(e);
      offset = Math.max(parseInt(offset, 10) || 0, 0);
      var rows = S.audit.slice().reverse().slice(offset, offset + 50);
      return ok({ entries: rows, total: S.audit.length });
    },
    adminAddGame: function (body) {
      return wrap(function () {
        var e = needAdmin();
        if (e) return Promise.reject(e);
        var u = current();
        body = body || {};
        var name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 80) return fail(400, 'Enter a game name of 2 to 80 characters.');
        var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) return fail(400, 'Enter a game name using letters or numbers.');
        var code = (String(body.code || '').trim() || name.split(/\s+/).map(function (w) { return w[0]; }).join('')).toUpperCase().slice(0, 4);
        var details = gameDetails(body);
        if (gameBySlug(slug)) return fail(409, 'That game already exists.');
        if (details.steam_app_id && S.games.some(function (g) { return g.steam_app_id === details.steam_app_id; })) {
          return fail(409, 'A game with that Steam App ID already exists.');
        }
        var g = { slug: slug, name: name, code: code, tint: (S.games.length % 8) + 1, metadata_source: 'manual', metadata_updated_at: Date.now() };
        Object.keys(details).forEach(function (k) { g[k] = details[k]; });
        S.games.push(g);
        logAudit(u, 'game_create', 'game', slug, { name: name });
        save();
        return ok({ slug: slug, name: name, code: code });
      });
    },
    adminEditGame: function (slug, body) {
      return wrap(function () {
        var e = needAdmin();
        if (e) return Promise.reject(e);
        var u = current();
        var details = gameDetails(body || {});
        var keys = Object.keys(details);
        if (!keys.length) return fail(400, 'Nothing to change.');
        var g = gameBySlug(slug);
        if (details.steam_app_id && S.games.some(function (o) { return o.steam_app_id === details.steam_app_id && o.slug !== slug; })) {
          return fail(409, 'Another game already has that Steam App ID.');
        }
        if (!g) return fail(404, 'Game not found.');
        keys.forEach(function (k) { g[k] = details[k]; });
        g.metadata_source = 'manual';
        g.metadata_updated_at = Date.now();
        logAudit(u, 'game_update', 'game', slug, { fields: keys });
        save();
        return ok({ slug: slug });
      });
    },
  };
})((window.FS = window.FS || {}));
