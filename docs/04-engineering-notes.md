# Engineering notes

**Author:** Senior Full-Stack Engineer
**Audience:** the Project Manager reviewing this build, and whoever maintains it next.

This records the decisions taken while implementing [`01-product-spec.md`](01-product-spec.md), and
why. Where I deviated from the spec's recommendation, that is called out explicitly.

---

## 1. Stack choice

The spec recommended Node with a small custom HTTP layer, SQLite and server-rendered HTML.
I kept that, and went one step further: **zero runtime dependencies**.

| Concern | Chosen | Why not the obvious alternative |
|---|---|---|
| HTTP | `node:http` + ~90-line router | Express would add a dependency tree and lockfile for path matching, body parsing and cookies — roughly 200 lines of `lib/` that I control, test and can read. With ~40 routes and no exotic middleware, the framework earns nothing here. |
| Rendering | Server-rendered auto-escaping tagged templates | React/Vue would add a build step, a second data model and a hydration story for pages that are fundamentally documents. Server rendering means fast first paint, working back button, and functioning pages with JS disabled. |
| Database | `node:sqlite` (built in since Node 22.5) | `better-sqlite3` needs a native build; Postgres needs a server to run. Real constraints, a single file, no compiler. All access goes through `db/index.js`, so a future Postgres move is a driver + dialect change, not a rewrite. |
| Tests | `node:test` | Vitest/Jest for 133 tests that need no transform, no JSX and no mocking framework would be pure overhead. |
| Templating | Tagged template with escape-by-default | The reason to hand-roll: escaping becomes the default and XSS an explicit opt-out (`raw()`), which is stronger than remembering to call a helper. |

The cost of this choice is honest: I wrote a router, a body parser, a cookie serialiser, a validator
and a tiny logger. All of it is in `src/lib`, all of it is tested, and total application code is
smaller than the dependency manifest of an equivalent Express + ORM + template-engine build.

**When to revisit:** if the platform needs multi-node deployment, background jobs, websockets or
multi-tenancy, move to Postgres and add a proper job runner. Nothing in the layering blocks that.

## 2. Design decisions worth knowing

### Slots are computed, never stored
Tutors describe availability once as a weekly pattern. `services/availability.js` expands that into
concrete slots on demand and subtracts the past, the booking lead time, time off and existing active
bookings. Storing generated slots would mean a reconciliation problem every time a tutor edits their
week; computing them means "the calendar shown is the calendar that is true".

### Double-booking is prevented twice
The service re-checks for overlap inside the same transaction as the insert, **and** the schema has
`CREATE UNIQUE INDEX ... ON bookings (tutor_id, starts_at) WHERE status IN ('pending','confirmed')`.
The service check gives a friendly message; the index guarantees correctness even if a future code
path forgets. There is a test that bypasses the service to prove the index holds.

### Status changes settle lazily
`settleElapsedBookings()` runs on read paths: confirmed sessions past their end time become
`completed`, and pending requests whose start time passed become `cancelled` with an explanatory
reason (plus notifications to both parties). No scheduler, no cron, and no stale "pending" request
sitting in a student's dashboard forever.

### Publication gate
A tutor is only discoverable with a headline, contact details for their chosen mode, at least one
subject and at least one availability block. Removing the last subject or block automatically
unpublishes. This is the single change that keeps search trustworthy — every result is bookable.

### Derived ratings
`tutor_profiles.rating_avg/rating_count` are recomputed from non-hidden reviews on every write
(create, hide, restore). Nothing writes them by hand, so a moderator hiding a review immediately and
correctly changes the tutor's public rating.

### Session cookies over JWTs
Server-side sessions can be revoked; JWTs cannot without inventing a denylist. Suspension and
password change need instant revocation, so the simple thing is also the correct thing. Only the
token digest is stored.

### Forms preserve input
Every validation failure re-renders from the **raw** submission, not the validated value (which is
undefined for a rejected field). This was a real bug caught by the integration tests: a rejected
registration wiped the typed email. Fixed in `routes/auth.js`.

### Oversized bodies get a 413, not a reset
The first implementation destroyed the socket when the byte ceiling was exceeded, which shows the
user a browser network error. It now drains up to 20× the limit so a proper 413 page can be
returned, and only cuts off genuinely abusive streams.

## 3. Deliberate non-implementations

Each of these was considered and left out on purpose, rather than half-built:

- **Rescheduling.** Cancel-and-rebook covers it; a propose/counter-propose flow is a second state
  machine and, done badly, a way to lose track of what was agreed.
- **Email/SMS.** Would need a provider, secrets, bounce handling and a queue. In-app notifications
  are the honest v1 (documented as a limitation, not hidden).
- **File uploads.** Avatars are deterministic initials. Uploads mean storage, size limits, content
  scanning and a new attack surface for no v1 benefit.
- **Websockets.** 15-second polling on an open thread is indistinguishable in practice at this scale
  and removes a whole class of connection-management bugs.
- **Per-user timezones.** One institution, one clock, labelled everywhere. Mixed-timezone display is
  where no-shows come from.

## 4. Where the bodies are buried

Things a maintainer should know before changing code:

- `src/lib/time.js` is the only place that converts between wall-clock and instants. DST correctness
  lives in `zonedWallClockToUtc` (offset guess, then verify). Tests cover a DST zone.
- `src/web/views/html.js` — if you ever add a `raw()` call, you are taking responsibility for that
  string being safe.
- `services/*.js` own all SQL. A route that reaches for the database directly is a bug.
- The partial unique index on `bookings` means an "update status" that moves a terminal booking back
  to `pending`/`confirmed` can fail. That is intentional: terminal statuses are terminal.
- Rate limiters are module-level singletons; tests call `clearAllLimiters()` between cases.
- `config.js` throws at boot on bad values (unknown timezone, non-integer numbers, missing
  production secret). Failing fast beats serving something subtly wrong.

## 5. Verification performed by the engineer before hand-off

Verified by execution:

- `npm test` — 133 checks, 8 suites, all passing (unit + HTTP integration against the real pipeline).
- A scripted walkthrough against a seeded server covering: landing, search (including junk filters),
  tutor profile, login/logout, student dashboard, sessions, messages, notifications, profile,
  request a session, tutor accept, tutor availability add/reject, admin console pages, and every
  admin page returning 200.
- Adversarial checks executed: POST without a CSRF token, POST with another visitor's CSRF token,
  direct URL access to another user's booking / conversation / notification / API endpoint, a student
  POSTing the tutor's accept endpoint, path traversal on static assets, junk and oversized query
  strings, an oversized request body, and script tags submitted through free-text fields (note,
  message, search) then confirmed escaped in the rendered HTML.

**Not verified by execution** (stated plainly rather than assumed):

- Visual rendering in a real browser. This environment has no browser, so the responsive layout
  (320 / 768 / 1280px breakpoints), focus-ring appearance, colour contrast in situ and screen-reader
  behaviour were implemented to the spec and reviewed in markup and CSS, but not seen. They need a
  human pass before anyone calls the UI signed off.
- Behaviour under real concurrency (two simultaneous requests for the same slot). The invariant is
  enforced by a transaction plus a database unique index, and the index is proven by a test that
  bypasses the service layer — but no load test was run.
- Production deployment concerns: TLS termination, `Secure` cookie behaviour and HSTS were coded for
  `NODE_ENV=production` but exercised only in development mode.
