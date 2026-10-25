# FileShelf

FileShelf is a site for utilities made for single-player PC games: trainers, save tools, mods, configuration
presets and performance or accessibility tools. Creators publish a listing, a moderator reviews it, and signed-in
people download it through short-lived private links. **My Vault** keeps the listings a person saved and their
download history. **Intel** is a directory of the games the site covers.

Everything on a new site is free. Paid listings are switched off until a payment provider has been set up and tested.

There are no npm dependencies. The server uses only what ships with Node 22.5 or newer
(`node:http`, `node:sqlite`, `node:crypto`). The front end is plain JavaScript, so there is no build step.

Product decisions, the audit of the original code and the staged plan are in `docs/`.

## Run it

```
cd server
npm run seed     # optional: demo accounts and listings for trying it out
npm start        # http://localhost:3000
npm test         # 48 tests
```

Open the site through the server, not by double-clicking `client/index.html`.

The seed creates these accounts, all with the password `placeholder-password`:

| Email | Role |
| --- | --- |
| `admin@fileshelf.test` (or your `ADMIN_EMAIL`) | admin |
| `moderator@fileshelf.test` | moderator |
| `creator1@fileshelf.test`, `creator2@fileshelf.test` | creator |
| `member@fileshelf.test` | member |

Everything the seed creates is marked as demo data: the listings are titled "Demo: ...", carry a "Demo data" badge, and
a bar across the top of the site says the database holds demo data. The files are random bytes and do nothing.
The passwords are public, so **never run the seed on a real site**. It refuses to run when `NODE_ENV=production`,
and on a production site any account the seed made is refused at sign-in.

Settings come from environment variables only. `.env.example` lists all of them with placeholder values.
Copy it to `.env` and run `npm run start:env` to load it.

## Roles

| Role | Can do |
| --- | --- |
| member (`user`) | Browse, download free listings, use the Vault. Becomes a creator by setting up a creator profile on the Sell page. |
| creator | Everything a member can, plus publish listings, edit or withdraw their own. Every new listing and every edit goes to review. |
| moderator | Everything a creator can, plus the review queue: approve, reject with a reason, or remove a live listing. Cannot approve their own listing. |
| admin | Everything a moderator can, plus feature listings, change roles, manage the games list and read the audit log. Can approve their own listing. Cannot change their own role. |

Permissions are checked on the server from the role stored in the database on every request, never from anything the
browser sends. The first admin is made by signing up with `ADMIN_EMAIL`, and only while no admin exists yet. After that
admins change roles from **Admin > Users**. Every approval, rejection, removal, feature, role change and game change is
written to an audit log. The database refuses edits and deletes on that table.

## Folders

```
client/    the front end, served by the server (one HTML file, a script per page in client/js/pages/)
server/    the API, storage and payments (src/), and its tests (test/)
docs/      AUDIT.md (what the original code did), PLAN.md (staged plan, decisions needed, status)
scripts/   build-demo.mjs and demo-api.js make a one-file demo that runs in a browser with no server;
           browser-check.cjs is a hand-run browser check
demo.html  the built demo
```

The site is a single-page app. The address after the `#` picks the page:
`#/` home, `#/browse`, `#/intel`, `#/games/<slug>`, `#/creators`, `#/creators/<username>`, `#/listing/<id>`,
`#/vault`, `#/sell`, `#/account`, `#/admin`, `#/help`, `#/terms`.

## How it works

**Database and migrations.** SQLite in one file. The schema changes through numbered migrations
(`server/src/migrations/`), recorded in a `schema_migrations` table and run in order when the server starts. Each one
runs in a transaction. Before a migration touches a database that already has accounts, the server copies the file to
`<database>.before-<migration id>`, so a bad upgrade can be rolled back by putting the copy back. A fresh database makes no
backup. Migration 002 changed the original schema: it added the four roles, the audit log, creator profiles,
categories, game details, saved listings and a listing id on download history. Anyone who already had listings became a
creator.

**Games and Intel.** The starter list is eight single-player games with their Steam App IDs
(`server/src/games-data.js`). Developer, publisher, release date and genres were entered by hand and are labelled as
such on the game page, with a link to the Steam store page as the reference. Admins can add games and edit these
details. **Player counts are not collected yet.** The game page says so instead of showing a number. Nothing is
estimated or invented. Live counts need a Steam data source (planned, see `docs/PLAN.md`).

**Listings.** A creator uploads the file people download, optionally a free version (only when paid listings are on), and
up to 6 images. Each listing has a game, a category, a version and a description. The review queue shows the file's
size, SHA-256 and scan result. A moderator downloads the file, checks it, then approves or rejects with a reason.
Creators can withdraw a listing. A moderator can remove a live listing, which stops further downloads.

**Downloads.** Any signed-in person can download an approved free listing. Visitors who are not signed in are asked to
sign in first, so the Vault can keep a history. The browser asks for a link, the server checks the rules and returns a
signed link that works for 5 minutes. Files are always sent as `application/octet-stream` with
`Content-Disposition: attachment`, and the link is checked again when it is used, so a listing removed a moment ago stops
working. Every download is logged with the listing id. Uploaded files are stored, hashed and served. They are never
executed, installed or opened by the server.

**My Vault.** Saved listings plus download history. It says "downloaded", never "installed", because a website cannot see
what is on a player's computer.

**File storage and scanning.** Files are streamed to disk, never held in memory, and saved under random names in
`server/data/storage/`, which is never served as static files. The extension is checked against an allowlist, images are
checked by their first bytes, and the SHA-256 is stored. Set `SCAN_COMMAND` (for example `clamscan --no-summary`) to scan
every upload: exit code 0 means clean, 1 means infected, anything else rejects the upload. The site shows "Not scanned"
or "Scanned, nothing found" and always adds that **a scan cannot promise a file is safe**. It never calls a file safe or
virus-free. For production, move `data/storage` to a volume you back up.

**Accounts.** Email and password. Passwords are hashed with scrypt. Sessions are stored on the server and sent in an
HttpOnly cookie. Sign-in has rate limits per address and per email, and the error never says which part was wrong.

**Payments.** Off by default (`PAYMENTS=off`): paid listings are rejected, and the checkout and payout routes do not
exist. `PAYMENTS=mock` is a test mode for development only and is refused in production. `PAYMENTS=stripe` uses Stripe
Checkout with Connect Express accounts. The signature checking, form encoding and webhook flow are tested, but the calls
to Stripe's live API are not, because they need real keys. Do not switch it on without a full test purchase and refund
using Stripe test keys. Amounts are whole pence, and the platform fee is `PLATFORM_FEE_BPS` (1000 = 10%), rounded down.

## Settings

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Port to listen on |
| `BASE_URL` | http://localhost:PORT | Public address. Must be https in production |
| `APP_SECRET` | dev value | Signs download links. Random, 32+ characters in production. The placeholder from `.env.example` is refused |
| `ADMIN_EMAIL` | none | The first account to sign up with this email becomes admin, while there is no admin |
| `CONTACT_EMAIL` | none | Shown on the Help page and in the footer. Hidden when empty |
| `DATA_DIR` | server/data | Database, uploads and temporary files |
| `DB_FILE` | DATA_DIR/fileshelf.db | Database file |
| `PAYMENTS` | off, or stripe if a key is set | `off`, `mock` or `stripe` |
| `STRIPE_SECRET_KEY` | none | Turns on real payments |
| `STRIPE_WEBHOOK_SECRET` | none | Checks webhook signatures |
| `PLATFORM_FEE_BPS` | 1000 | Fee in basis points |
| `MAX_UPLOAD_MB` | 200 | Largest file |
| `MAX_IMAGE_MB` | 5 | Largest image |
| `ALLOWED_EXTENSIONS` | zip,7z,rar,gz,tar,pdf,txt,md,json,csv,xlsx,docx,pptx,png,jpg,jpeg,webp | File types accepted |
| `SCAN_COMMAND` | none | Virus scanner to run on each upload |
| `TRUST_PROXY` | 0 | Set to 1 behind a reverse proxy so visitor addresses are read from `X-Forwarded-For` |
| `NODE_ENV` | none | `production` refuses unsafe settings (default or placeholder secret, test payments, non-https address) |

## Before going live

1. Run behind HTTPS (Caddy, nginx or similar). Set `NODE_ENV=production`, `BASE_URL`, `APP_SECRET`, `ADMIN_EMAIL`,
   `CONTACT_EMAIL` and `TRUST_PROXY=1`. Do not run the seed.
2. Sign up with `ADMIN_EMAIL` first, so the admin account is yours. Then make moderators from Admin > Users.
3. Install a virus scanner and set `SCAN_COMMAND`. Until then every file shows "Not scanned" and moderators are the only check.
4. Read `docs/PLAN.md`. Four decisions are still open: the default theme, how executables are handled, which scanner
   to use, and where Steam data comes from.
5. Have a lawyer read the Content rules page before opening to the public. It is written in plain language and is not legal advice.
   Decide how takedown requests and abuse reports reach you. There is no report button yet, so the Help page says to email you.
6. Back up `DATA_DIR`. The database and the uploaded files must be backed up together. Keep the `.before-` copies the
   migrations make until you are sure an upgrade worked.
7. Do not commit `server/data` or `.env`.

## Limits to know about

- The database is SQLite in one file, so run one server process. It suits a small to medium site.
- Rate limits are kept in memory and reset when the server restarts.
- There are no emails yet: no verification, no password reset, no alerts. A forgotten password cannot be recovered.
- Files are not scanned unless `SCAN_COMMAND` is set, and there are no archive checks yet.
- Releases and changelogs, update notices, abuse reports, player counts and game comparison are planned, not built.
  `docs/PLAN.md` says which stage each belongs to.

## Tests

`npm test` in `server/` runs 48 tests with Node's built-in runner: the API, permissions between roles, migrations
(including upgrading an old database and backups), the audit log, uploads, downloads, payments and configuration.
`scripts/browser-check.cjs` is a browser check you run by hand (it is not part of `npm test`, and Playwright is not a
project dependency). It opens every public page at desktop and phone width looking for script errors and sideways
overflow, then signs up a creator on a phone, publishes a listing, approves it as a moderator and visits the admin
screens. The instructions are at the top of the file. Proper browser tests in the repository are planned for Stage E.

## Demo

`demo.html` is a single file that runs the real front end against a fake in-browser server with demo data.
Double-click it to open it. No server is needed, nothing is uploaded, and the demo keeps its data in that browser only.
Rebuild it after changing the front end with `node scripts/build-demo.mjs --standalone`.
