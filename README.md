# PeerLearn — campus peer tutoring platform

Students who need help and students who can give it cannot find each other. PeerLearn fixes the
discovery, scheduling and trust problem: search peer tutors by subject, see availability that is
actually bookable, request a session, and build a public record of sessions and reviews.

Built as a server-rendered Node.js application with **zero runtime dependencies** — no build step,
no package installs, no external database server.

- Full product and technical specification: [`docs/01-product-spec.md`](docs/01-product-spec.md)
- Engineering decisions: [`docs/04-engineering-notes.md`](docs/04-engineering-notes.md)
- Review and QA records: [`docs/02-pm-review.md`](docs/02-pm-review.md), [`docs/03-qa-report.md`](docs/03-qa-report.md)

---

## Requirements

- **Node.js 22.13 or newer** (24 recommended). The app uses the built-in `node:sqlite` module,
  the built-in test runner and `--env-file`, so nothing else is needed. Node 22.5–22.12 shipped
  `node:sqlite` behind `--experimental-sqlite`; from 22.13 it needs no flag.
- No database server, no compiler, no `npm install`.

Check your version:

```bash
node --version
```

## Quick start

```bash
# 1. Configuration (the app also runs on defaults if you skip this)
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 2. Create the database and load demo data
npm run seed

# 3. Start the server
npm start
```

Then open <http://127.0.0.1:3000>.

`npm run seed` prints the demo logins. All demo accounts share the password `Password123!`
(a demo value, not a secret); the administrator password comes from `SEED_ADMIN_PASSWORD`.

| Role | Email | Password | Good for seeing |
|---|---|---|---|
| Student | `maya@peerlearn.test` | `Password123!` | Upcoming session, past sessions, reviews written |
| Student | `chloe@peerlearn.test` | `Password123!` | A pending request awaiting a tutor decision |
| Tutor | `naledi@peerlearn.test` | `Password123!` | Published profile, reviews received, availability |
| Tutor | `thabo@peerlearn.test` | `Password123!` | Free (no rate) online-only tutor |
| Tutor | `kabelo@peerlearn.test` | `Password123!` | An **incomplete** profile blocked from publishing |
| Admin | `admin@peerlearn.test` | value of `SEED_ADMIN_PASSWORD` | Stats, users, subjects, review moderation, audit log |

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server (migrations applied automatically at boot) |
| `npm run dev` | Same, with `--watch` restart on file changes |
| `npm run migrate` | Apply pending migrations and print the schema |
| `npm run seed` | Seed demo data (`npm run seed -- --force` replaces existing data) |
| `npm run reset` | Delete the database file so the next run rebuilds it |
| `npm test` | Run the full automated test suite |
| `npm run test:tap` | Same, with TAP output (useful in CI) |

## Configuration

Everything is optional in development. Copy `.env.example` to `.env` and adjust.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables `Secure` cookies and HSTS, and **requires** `SESSION_SECRET` (≥ 32 chars) |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Listen address |
| `SESSION_SECRET` | dev placeholder | HMAC key for signed cookies (flash messages, anonymous CSRF) |
| `DATABASE_FILE` | `./data/peerlearn.db` | SQLite file location |
| `APP_TIMEZONE` | `UTC` | Institution timezone; all availability and session times are shown in it |
| `APP_NAME` | `PeerLearn` | Product name in the UI |
| `CURRENCY_SYMBOL` | `$` | Symbol for indicative tutor rates (no payments are processed) |
| `SLOT_MINUTES` | `60` | Length of one bookable session |
| `BOOKING_WINDOW_DAYS` | `21` | How far ahead slots are offered |
| `BOOKING_LEAD_HOURS` | `2` | Minimum notice before a session may start |
| `MAX_ACTIVE_REQUESTS` | `5` | Simultaneous pending requests per student |
| `SESSION_TTL_HOURS` | `168` | Session lifetime (sliding) |
| `TRUST_PROXY` | `false` | Set `true` only behind a proxy that sets `X-Forwarded-For` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | see file | Credentials the seed script uses for the first admin |

**Secrets are never committed.** `.env` is git-ignored; `.env.example` documents the shape;
`.env.test` holds throwaway values used only by the test run.

## Architecture

```
src/
  server.js              process entry: open + migrate the database, then listen
  config.js              environment parsing and validation
  lib/                   framework-free building blocks
    router.js            path patterns -> handler chains
    http.js              cookies, body parsing, responses, flash, redirect safety
    security.js          scrypt hashing, token generation, HMAC signing
    validate.js          one validator for pages and the JSON API
    time.js              UTC storage, timezone-aware display, slot maths
    errors.js            HttpError / DomainError / ValidationError / RedirectError
    ratelimit.js         fixed-window limiter
    logger.js            structured, PII-free request log
  db/
    index.js             SQLite wrapper: prepared statements, transactions, migrations
    migrations/          numbered, forward-only SQL
  services/              all business rules and all SQL
    auth users tutors subjects availability bookings messages reviews notifications admin
  web/
    app.js               request pipeline (headers -> static -> session -> route -> errors)
    middleware.js        requireAuth / requireRole guards
    routes/              one module per area, no SQL here
    views/               auto-escaping HTML templates
    static.js            asset serving with traversal protection
  public/                css, progressive-enhancement js, favicon
tests/                   node:test unit + HTTP integration suites
scripts/                 migrate, seed, reset
```

**Request flow:** security headers → static assets → cookies → session lookup → request context
(user, CSRF token, flash) → route match → body parse + CSRF check for unsafe methods → guards →
handler → error translation (redirect, friendly page, or JSON — never a stack trace).

**Layering rule:** routes validate input and render; services own business rules and every SQL
statement; the database owns integrity (foreign keys, `CHECK` constraints, and a partial unique
index that makes double-booking impossible even if application code is bypassed).

**Rendering:** pages are server-rendered through an auto-escaping tagged template, so user data is
escaped by default and XSS requires an explicit opt-out. A small vanilla script adds submit-once
guards, character counters, relative timestamps, notification polling and live message polling —
every page works without it.

### Data model

`users` (+ `student_profiles` / `tutor_profiles`), `subjects`, `tutor_subjects`,
`availability_blocks`, `tutor_time_off`, `bookings`, `conversations`, `messages`, `reviews`,
`notifications`, `sessions`, `audit_log`. See
[`src/db/migrations/001_init.sql`](src/db/migrations/001_init.sql) — it is commented and readable.

Times are stored as ISO-8601 UTC strings and displayed in `APP_TIMEZONE`.
Tutor `rating_avg` / `rating_count` are derived from visible reviews and recomputed on every write.

## Security

- Passwords: **scrypt** (N=16384, r=8, p=1) with a per-user 16-byte salt, verified in constant time.
- Sessions: opaque 256-bit token in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production);
  only the SHA-256 digest is stored, so a database dump cannot be replayed. Revoked instantly on
  logout, password change and suspension.
- CSRF: a per-session token on every state-changing form and `X-CSRF-Token` for JSON calls;
  anonymous forms use a signed double-submit cookie.
- Authorisation: `requireAuth` / `requireRole` guards **plus** an ownership check inside every
  service. Another user's booking, conversation or notification returns 404/403, not data.
- SQL: prepared statements with bound parameters only.
- Output: escaped by default; stored URLs are restricted to `http(s)`; `?next=` cannot be used as an
  open redirect.
- Headers: CSP without `unsafe-inline`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS in production.
- Rate limits on login, registration, password change, messaging, booking and reviews.
- Errors: user-safe messages only; stacks go to the server log.

## Testing

```bash
npm test
```

**228 checks across 43 suites**, using only the built-in runner:

- `security.test.js` — hashing, tokens, signing, output escaping, redirect safety, query coercion
- `time.test.js` — clock parsing, calendar maths, timezone/DST conversion
- `auth.test.js` — registration, login, sessions, suspension, password-change revocation
- `availability.test.js` — block validation, slot generation (lead time, window, time off, taken slots)
- `bookings.test.js` — lifecycle, authorisation, double-booking, request caps, auto-settlement
- `search.test.js` — every filter individually and combined, sorting, pagination, visibility rules,
  literal `LIKE` characters, rendered empty state
- `profile.test.js` — student profile persistence, tutor profile validation, subjects, publish gate
- `community.test.js` — review gating and rating aggregates, messaging rules, unread counts
- `admin.test.js` — suspend/reinstate, subject catalogue, review moderation, stats, audit trail
- `views.test.js` — error page, accessible form markup, page shell, no inline script or style
- `http.test.js` — end-to-end pipeline: guards, CSRF, 404/405, XSS escaping, cross-user access,
  admin read-only view, filter coercion

Each suite runs against its own temporary SQLite database, so tests are isolated and leave nothing
behind.

## Deploying

The database is a file on disk, so the host must give the process a **persistent volume**. Any
container host with disks works (Railway, Render, Fly.io, a VPS). Serverless platforms such as
Vercel or Netlify Functions do **not** — their filesystem is ephemeral and per-instance, so bookings
and accounts would silently disappear. Run **one instance**: SQLite has a single writer and the rate
limiter is in-process.

### Railway (worked example)

`railway.json` in the repo root already sets the start command, health check and restart policy.
Values in that file override the dashboard for the deployment that uses it.

1. **Create the service** — Railway → *New Project* → *Deploy from GitHub repo* → pick this repo.
   No build command is needed; there are no dependencies to install.
2. **Add a volume** — right-click the project canvas → *Volume* → attach it to the service with
   mount path **`/data`**. (Railway puts your code in `/app`, so a separate `/data` mount keeps the
   database away from the deployment bundle.)
3. **Set variables** on the service:
   ```
   NODE_ENV=production
   SESSION_SECRET=<64 hex characters>
   DATABASE_FILE=/data/peerlearn.db
   APP_TIMEZONE=Africa/Johannesburg     # your institution's timezone
   APP_NAME=PeerLearn
   CURRENCY_SYMBOL=R
   RAILPACK_NODE_VERSION=24             # NIXPACKS_NODE_VERSION=24 on older builders
   ```
   Generate the secret with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Do **not** set `PORT` (Railway injects it) and do not set `HOST` (the start command binds
   `0.0.0.0`, which is what makes the container reachable).
4. **Deploy**, then *Settings → Networking → Generate Domain*.
5. **Create the first admin.** Migrations run automatically at boot; demo data does not. Either:
   - open a shell on the running service (`railway ssh`, or the service's terminal) and run
     `npm run seed` — it is idempotent and refuses to overwrite a database that already has users; or
   - temporarily set the start command to `node scripts/seed.js && npm start` for one deploy; or
   - skip seeding entirely, register a real account, and promote it to admin:
     ```bash
     node -e "const {getDb}=await import('./src/db/index.js');getDb().run(\"UPDATE users SET role='admin' WHERE email=?\",['you@example.edu'])" --input-type=module
     ```
   If you seed, set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` first and change the password after
   first login.

**Troubleshooting:** a failing health check almost always means the process bound to `127.0.0.1`
instead of `0.0.0.0`. A `SESSION_SECRET must be set…` boot error means step 3 was skipped —
that check is deliberate. If the app starts but data resets on redeploy, the volume is not mounted at
the path in `DATABASE_FILE`.

### Backups

The whole database is one file. With the volume mounted, copy `/data/peerlearn.db` (plus `-wal`
and `-shm` if present) on a schedule, or run `sqlite3 /data/peerlearn.db ".backup /data/backup.db"`.

## Accessibility and responsiveness

Semantic landmarks, one `h1` per page, skip-to-content link, visible focus rings, real labels wired
to inputs with `aria-describedby` / `aria-invalid`, status conveyed by text as well as colour,
keyboard-operable menus (native `<details>`), 44px touch targets, and layouts verified at 320px,
768px and 1280px. Admin tables restack into labelled rows on narrow screens instead of scrolling
sideways.

Automated checks cannot prove accessibility. Full conformance still needs manual testing with
screen readers and expert review.

## Known limitations

- **Single node only.** Rate limiting is in-process; running multiple instances would need shared
  storage. SQLite handles this scale comfortably but is one writer at a time.
- **One platform timezone.** Deliberate (spec assumption A6): every time is shown in
  `APP_TIMEZONE` with its label rather than per-user conversion.
- **No email or SMS.** Notifications are in-app only, so a user who never signs in is never told.
- **No payments and no video.** Rates are indicative; sessions happen in person or on a link the
  tutor supplies.
- **No rescheduling.** Cancel and rebook is the v1 answer.
- **No file uploads.** Avatars are generated initials.
- Real-time updates use polling (15s messages, 60s notification badge), not websockets.
- **The UI has not been verified in a browser.** It was built and reviewed as markup and CSS with
  breakpoints at 960/720/400px, but no human has looked at a rendered page in this environment, so
  visual layout, focus-ring visibility and contrast in situ are unconfirmed. See
  [`docs/03-qa-report.md`](docs/03-qa-report.md) section 4.
- Login rate limiting is per source address, not per account.

## Licence

MIT.
