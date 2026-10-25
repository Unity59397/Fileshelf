# FileShelf audit (Stage A)

Written from the code as it stands, before any Stage B changes. Dates: 24 October 2026.

## What exists

**Stack.** Node 22.5 or newer with no npm dependencies. The server uses `node:http`, `node:sqlite`, `node:crypto` and `node:test`.
The front end is plain JavaScript in one HTML page (`client/index.html`) with a hash router. There is no build step.
This was chosen because the package registry was unreachable while building. It also keeps the attack surface small,
so there is no reason to change it.

**Size.** About 4,300 lines across the server, tests, front end and stylesheet. 25 automated tests, all passing.

**Database.** SQLite in one file (WAL mode, foreign keys on). The schema is one block of `CREATE TABLE IF NOT EXISTS`
statements run on every start. There are no migrations.
Tables: `users`, `sessions`, `games`, `files`, `listings`, `listing_images`, `orders`, `download_log`, `webhook_events`.

**Features that work and are tested**

- Sign up, sign in, sign out. Passwords hashed with scrypt, sessions stored on the server, HttpOnly SameSite cookie.
- Rate limits on sign-up, sign-in (per address and per email), uploads, checkout and download links.
- Uploads streamed to disk, extension allowlist, image signature check, SHA-256 stored, optional external scan command.
- Private file storage. Files are never served as static files. Downloads use signed links that last 5 minutes, with
  `attachment`, `application/octet-stream` and `nosniff`.
- Listings with a review step. A listing is hidden until approved. Any edit sends it back to review.
- Admin review queue (approve, reject with reason, remove a live listing).
- Games directory, browse with search, sort and pagination, listing detail, account area, seller sales view.
- Test payments and a Stripe Connect path. The Stripe path is only tested with local fixtures.
- Security headers including a strict Content-Security-Policy, and an Origin check on every write.
- Production guards: refuses to start with the default secret, test payments or a non-https address.

## Gaps against the brief

| Brief area | Current state |
| --- | --- |
| Roles | Only `user` and `admin`, enforced by a CHECK constraint. The admin is whoever signs up with `ADMIN_EMAIL`. No creator or moderator role, and no way to change a role. |
| Creator profiles | None. Listings show the seller's username only. |
| Categories and compatibility | None. A listing has a game, a title, a summary, a description, a feature list and one version string. No category, operating system, supported game versions, prerequisites, install or removal steps, or licence. |
| Releases and changelogs | None. One version string per listing, and one file. Uploading a new file means a new listing. |
| Vault | Not started. `download_log` has no listing id and is not shown to users. |
| Intel | Not started. The six games are placeholders ("Game One" to "Game Six") with no metadata. |
| Scan states | Only `unscanned` and `clean`. A flagged file rejects the whole upload, and a scanner that fails returns an error. Nothing records `pending`, `suspicious`, `failed` or `unavailable`, or which scanner said so. |
| File content validation | Images are checked by their first bytes. Archives and documents are checked by extension only. |
| Approval and scans | An admin can approve a listing whose file was never scanned. The queue shows a warning but nothing enforces it. |
| Executables | The allowlist contains archives and documents, no `.exe` or `.dll`. That is the safer default, but trainers are normally executables, so a rule is needed (see the plan). |
| Audit log | None. Reject and remove reasons are kept on the listing and overwritten by the next action. |
| Abuse reports | None. |
| Payments | Test mode shows a checkout page. It is labelled as test mode, but the brief wants the first release to support free items and not to look like it takes payments. |
| Placeholder copy | Every headline, summary and footer line is placeholder text. The seed data is "Listing title 1" and similar. |
| Navigation | Browse, Sell, Help, sign in and account. No My Vault, Intel or Creators. |
| Theme | Light by default with a hidden dark mode, from your earlier request. The brief describes a dark default (see decisions below). |
| Deployment | README and environment table only. No `.env.example`, no migrations, no Dockerfile. |
| Tests | 25 API and unit tests. No browser tests are in the repository. The browser checks I ran live outside it. |

## Security notes

- Rate limits are in memory. They reset on restart and are per process. Behind a reverse proxy, `TRUST_PROXY=1` must be
  set or every visitor shares one address.
- There is no email verification and no password reset, so a typo in an email address locks the account.
- Changing a password (once it exists) must end other sessions. There is no such feature yet.
- Sessions last 14 days with no idle timeout or "sign out everywhere".
- Admin access comes from an environment variable at sign-up. If that email is registered by someone else first
  (for example on a fresh install), that person becomes admin. Role changes should be made by an existing admin instead.
- The download log stores IP addresses with no retention limit.
- Approved listing images are sent with `Cache-Control: public`. That is fine for public images, but a listing that is
  removed later stays in browser and proxy caches for up to an hour.
- One design strength to keep: nothing in a public API response contains a storage path, and the tests assert it.

## What I'm keeping

Everything above that works. The stack, the routing, the storage layout, the signed-download design, the review
step, the tests, and the visual identity (`>_` wordmark, amber accent, terminal details).
