# FileShelf plan

Based on `docs/AUDIT.md`. Each stage ends with a report of what changed, which tests passed, what is left and which
settings are needed. Nothing is marked done until it has a test.

## Decisions I need from you

1. **Default theme.** The brief says dark and near-black. The site currently opens light, with dark behind the `>_`
   button, because of your earlier request. I have left it light. It is a one-line change either way.
2. **Executables.** Trainers are usually `.exe` files. My proposal: executables are only accepted inside a `.zip`
   (or `.7z`), the archive's file list is read on the server without extracting anything, and anything with an
   executable inside gets the strictest path: it needs a clean scan from a named scanner and a moderator's approval.
   Raw `.exe` and `.dll` uploads stay blocked.
3. **Malware scanning.** Options are a local ClamAV daemon (free, I can wire it in and test it here if it installs) or
   a hosted service such as VirusTotal. Read the hosted service's terms first, since some free tiers forbid
   commercial use. Until one is configured, files show "not scanned" and cannot be approved without a written override.
4. **Steam data.** The player-count endpoint is part of the Steam Web API. I believe it needs no key, but I cannot
   reach Steam from the build environment, so the first live check has to be done on your machine. Game descriptions
   and cover art need either the Steam Store API (not formally documented) or another permitted source. Decide
   whether to enter those by hand for now.
5. **Email.** Verification and password reset need a mail provider (SMTP details or an API key).

## Stage B: foundation (built, 48 server tests, checked in a browser)

1. Versioned migrations with a `schema_migrations` table and automatic backups. **Done.**
2. Roles: user, creator, moderator, admin, checked on the server. Admins change roles. An append-only audit log records
   every moderation action, role change and game change. **Done.**
3. Categories (the six from the brief) and a real starter list of eight single-player PC games with Steam App IDs.
   Category filter on browse and a category on every listing. **Done.**
4. Intel: a games directory with search and sort, and a game page. Player counts say "not configured" until a provider
   is set up. No numbers are invented. **Done** (the Steam adapter itself is Stage D).
5. Navigation: Home, Browse, My Vault, Intel, Creators, Sell, Help, an account menu and a phone menu, each leading to a
   working page. Save to Vault, saved list and download history. Creator profiles and a directory. **Done.**
6. Real copy in place of placeholders. Seed data is labelled as demo data and cannot sign in on a production site. **Done.**

Left over from this stage, and moved to later stages: a report button on listings (Stage C), a command to remove demo
data from a database (Stage E), browser tests in the repository (Stage E).

## Stage C: creator and file workflows

1. Listing model: operating system, supported game versions, prerequisites, install and removal steps, licence.
2. Releases: each listing has releases with a version, a changelog and its own file, SHA-256 and scan record. Old
   releases are kept. A new release goes through moderation.
3. Scan states: `pending`, `clean (named scanner)`, `suspicious`, `failed`, `unavailable`. A flagged file is kept in
   quarantine for review instead of being deleted. Approval requires a clean scan or a written override.
4. Archive signature checks (zip, 7z, gzip), and the executable rule from decision 2.
5. Free listings first. Paid listings stay off until a payment provider is chosen and tested. The test checkout page is
   hidden unless an environment flag turns it on.
6. Abuse reports and the moderation queue for them.
7. Tests for every permission boundary: users, creators, moderators and admins against each other's data.

## Stage D: Vault and Intel

1. Vault: latest release, a "version I use" note, compatibility notes and update notices when a saved listing gets a
   new release. It will say "downloaded", never "installed", because a website cannot see the player's computer.
2. Steam adapter with a cache and visible "last updated" times. Tested with recorded fixtures and a stub server.
3. Scheduled sampling of player counts into a snapshots table at a fixed interval, with charts only from our own
   samples. No scraping or copying of other statistics sites.
4. Game comparison.

## Stage E: quality

1. Browser tests added to the repository (Playwright as an optional dev tool, since the project has no dependencies).
2. Accessibility and performance pass, security review, email verification and password reset.
3. `.env.example`, Dockerfile, deployment notes, backup and restore steps.

## Settings that will be needed

`APP_SECRET`, `BASE_URL`, `ADMIN_EMAIL`, `TRUST_PROXY`, `DATA_DIR` (exists today).
Later: `SCAN_COMMAND` or a hosted scanner key, `STEAM_PLAYER_COUNTS` (on or off), `SMTP_URL` or a mail API key,
and Stripe keys only when paid listings are turned on.

## Brief acceptance criteria: status after Stage B

"Done" means it is built and covered by an automated test or, for screens, checked by hand in a headless browser at
1280 and 390 pixels wide. There are no automated browser tests yet.

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Browse and search real listings | Done. Search covers title, summary and game name, with game, category, featured and free filters. |
| 2 | Listing detail page | Done |
| 3 | Save to Vault | Done. Saved list and download history. No update notices yet (Stage D). |
| 4 | Authorised downloads of approved files | Done. Signed five-minute links, checked again on use. |
| 5 | Creators submit for moderation | Done. A creator profile is required. Every new listing and edit is reviewed. |
| 6 | Admin approves or rejects | Done, with moderators, a reason on every rejection and an audit log. |
| 7 | Versions and changelogs | Not started (Stage C). A listing has one version string and no history. |
| 8 | Intel search with real data | Partly. Search and sort work on hand-entered game details. No player counts or charts yet (Stage D). |
| 9 | Unavailable data clearly labelled | Done for player counts, scan results and game details. |
| 10 | Mobile and desktop | Done for every current page |
| 11 | Automated tests for core workflows | Partly. 48 server tests. No browser tests (Stage E). |
| 12 | No exposed secrets or private files | Partly. Production refuses weak settings and demo sign-ins. A full security review is Stage E. |
