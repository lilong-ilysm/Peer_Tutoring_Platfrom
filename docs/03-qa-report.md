# QA report

**Under test:** PeerLearn, after the engineer's fixes for PM review round 1.
**Environment:** Node 24.19.0 on Windows, `APP_TIMEZONE=UTC`, seeded demo database
(13 users, 14 subjects, 12 bookings, 6 reviews), server on `127.0.0.1:3000`.
**Objective:** break it. Not "confirm the happy path works".

**Method.** Three layers:

1. The automated suite (`npm test`) — 228 checks, 43 suites, run against isolated temp databases.
2. A scripted end-to-end walkthrough of every page and primary flow against the live server.
3. An adversarial probe: 55 targeted attacks on input handling, session/CSRF integrity, authorisation
   boundaries, injection, concurrency, unicode, length limits and static-file traversal.

---

## 1. Bugs found

### BUG-001 — Out-of-range numeric filters are clamped, silently applying a filter the visitor never chose

| Field | Detail |
|---|---|
| **Bug ID** | BUG-001 |
| **Severity** | **MEDIUM** (wrong results shown as if correct; no security impact) |
| **Feature** | Tutor search — query-string filter coercion |
| **Steps to reproduce** | 1. Open `/tutors` and count the results (6 tutors on seed data).<br>2. Open `/tutors?subject=0`.<br>3. Open `/tutors?day=99`.<br>4. Open `/tutors?day=-3`. |
| **Expected result** | `subject=0`, `day=99` and `day=-3` are not valid values, so they should be ignored and all 6 tutors listed (AC-21: malformed filters are ignored or clamped, but the result must not mislead). |
| **Actual result** | Each returned **2 tutors**. `coerceInt` clamped `0` up to `1` (filtering by subject #1, "Calculus Basics"), `99` down to `6` (filtering to Saturday) and `-3` up to `0` (filtering to Sunday). The filter controls showed no sign that a filter was active, so a student would conclude only 2 tutors exist. |
| **Recommended fix** | Clamping is right for a page number but wrong for an identifier or a weekday. Give `coerceInt`/`coerceFloat` a `clamp` option and use `clamp: false` for `subject`, `day`, `rating` and `maxRate`. |
| **Status** | **FIXED** — `src/lib/validate.js` + `src/web/routes/public.js`. Regression tests: `security.test.js` "clamping is opt-in…" (unit) and `http.test.js` "out-of-range filters are ignored, not clamped into a different filter" (HTTP, asserts the result count is unchanged for `?subject=0`, `?day=99`, `?day=-3`, `?rating=9`, `?maxRate=-5`). Re-probe: 6 of 6 tutors returned in every case. |

No other defects were found in this round. The three findings from the PM audit
(dead admin control, `LIKE` wildcards, per-review rating count) were fixed before QA started and were
re-verified here as part of the probe.

## 2. What was attacked and held

Every item below was executed, not reasoned about.

### Authentication and session integrity
- Forged `pl_session` cookie → treated as anonymous, redirected to login.
- Tampered `pl_csrf` cookie and mismatched token → 403.
- Tampered signed flash cookie → ignored, page still renders.
- Another visitor's CSRF token replayed → 403.
- POST with no CSRF token at all → 403.
- Login with wrong password vs unknown email → byte-identical message (no enumeration).
- 12 rapid failed logins → 429 with a retry hint.
- Open redirect attempts (`next=//evil.example.com`, `next=https://…`, backslash and newline
  variants) → forced back to `/dashboard`.
- Suspension mid-session → the victim's next request is signed out; re-login refused with an
  explanation; reinstate restores access.

### Authorisation boundaries
- Student → tutor-only pages and admin console: 403.
- Student → `POST /bookings/:id/accept` with a valid CSRF token: 403 (the UI hides it *and* the
  server refuses it).
- Student → another student's booking, conversation and `/api/conversations/:id/messages`: 404 with
  no content leak (checked the response body for the private note and message text).
- Tutor → the student-only booking form: 403.
- Admin → participant sessions list: 403. Admin → booking detail: 200 read-only, with no
  accept/decline/cancel controls, and a forged cancel POST still refused.
- Notification unread count for a stranger: 0.

### Input handling
- SQL-looking keyword `' OR 1=1; DROP TABLE users;--` → 0 results, no error, `users` intact.
- `LIKE` metacharacters `%`, `_`, `\` → treated literally (0 results), while a real keyword still
  matches.
- Junk filters (`minRating=abc`, `page=-42`, `maxRate=zzz`, `sort=drop table`, `subject=abc`,
  `rating=<script>`) → 200, no filter applied, echoed values escaped.
- Unknown subject id → empty result, not an error.
- Non-numeric and hostile route ids (`/tutors/abc`, `/tutors/1.5`, `/tutors/1%00`, `/tutors/-1`,
  `/bookings/abc`, `/messages/abc`, `/notifications/abc/read`, `/api/conversations/abc/messages`) →
  404 every time, no 500s.
- Over-long name (200 chars), whitespace-only name, over-long goals (600 chars), impossible year of
  study (42), over-long note, over-long message (2500 chars), empty message → rejected with
  field-level messages, values preserved.
- Unicode and emoji in names and messages → accepted and round-tripped intact.
- 200KB request body → 413 with a friendly page, connection not reset, no stack trace.
- `__proto__` in a form body → dropped by the parser.

### Stored XSS (the one that matters most)
Saved `<script>alert("xss")</script> "quoted" & <img src=x onerror=alert(2)>` into a tutor headline,
bio and campus field; sent it as a message; submitted it as a booking note; and created a subject
named `<script>alert(1)</script>` as an admin. Then inspected the rendered HTML of the search page,
tutor profile, message thread, booking detail and admin subjects table: **no executable markup in any
of them**, escaped text visible instead. A `javascript:` meeting link was rejected at input.

### Booking integrity
- Cancel a confirmed session → slot returns to the calendar and can be rebooked.
- Cancel the same session twice → refused.
- Decline a request → cannot then be accepted.
- **Concurrency:** two students POSTed the same slot simultaneously (`Promise.all`, no awaiting
  between them). Exactly one 302'd to a new booking; the other was redirected with
  "Someone just booked that slot". Database check confirmed one live booking for the slot.
- A slot from a different tutor's calendar, and a slot outside the lead time → refused.
- Booking an admin or a student "as a tutor" → 404.

### Platform hygiene
- Path traversal: `/../package.json`, `/%2e%2e%2fpackage.json`, `/css/%2e%2e%2f%2e%2e%2fpackage.json`,
  `/js/../../../package.json` → 404.
- `OPTIONS /` and `PUT /tutors` → 405 with an `Allow` header; `HEAD /` → 200.
- CSP present with `script-src 'self'` and no `unsafe-inline`; `X-Frame-Options: DENY`;
  `X-Content-Type-Options: nosniff`; `Cache-Control: no-store` on pages.
- Cookies are `HttpOnly; SameSite=Lax` (and would be `Secure` in production).
- Admin flows: duplicate subject code refused with a message, empty subject form rejected per field,
  hostile subject name escaped, review hide/restore works, administrators cannot be suspended, every
  action appears in the audit log.

## 3. Improvement report (not bugs)

| ID | Severity | Observation | Decision |
|---|---|---|---|
| IMP-1 | LOW | A student could send messages into a **suspended** tutor's conversation. Nothing broke, but the message could never be read and the suspended account still accumulated notifications. | **Fixed** — `sendMessage` now refuses with "That account is currently unavailable…". Test added in `community.test.js`. |
| IMP-2 | LOW | The search keyword only applies on "Apply filters" while dropdowns auto-apply on change. Slightly inconsistent. | Deferred. Auto-submitting per keystroke is worse; a debounce needs more client JS than the progressive-enhancement budget allows. |
| IMP-3 | LOW | A brand-new student sees three stacked empty states (next session, pending requests, suggestions). Correct, but reads as an empty room. | Deferred — logged as a v1.1 UX task in the PM review. |
| IMP-4 | LOW | Login rate limiting is per IP only, so a distributed attempt at one account is not slowed by an account-level counter. | Deferred and documented. Passwords are scrypt-hashed with a 10-character minimum; an account lockout also introduces a denial-of-service vector, so this needs a product decision rather than a quick patch. |
| IMP-5 | LOW | The notification list shows the 50 most recent with no pagination. | Deferred; the page states it is showing the most recent items. |
| IMP-6 | INFO | Removing an availability block does not affect sessions already booked inside it (the booking keeps its own start/end). Correct behaviour, but not obvious to a tutor. | Documented in the engineering notes; a future UI hint would help. |

## 4. Responsive and accessibility testing — scope limit

**I could not run a browser in this environment.** What I did check, by inspecting the served HTML
and CSS:

- Exactly one `h1` per page (landing, search, dashboard, sessions, profile, admin).
- Skip link, `<main id="main">`, labelled `<nav>` landmarks, `aria-live` flash region.
- Every input has a `<label for>`; invalid fields carry `aria-invalid` and `aria-describedby`
  pointing at a real element id; the error summary links to each field anchor.
- No `role="tab"` misuse after the PM-4 fix; the notification bell announces its count.
- No inline `style=` or inline `<script>` anywhere, so the strict CSP cannot silently break layout.
- Breakpoints exist and are coherent at 960px, 720px and 400px: nav wraps to its own row, grids
  collapse to one column, admin tables restack with `data-label` captions, touch targets are ≥ 40px.

**Not verified:** actual pixel rendering, real focus-ring visibility, colour contrast in situ,
screen-reader output, and behaviour at exactly 320/768/1280px on real devices. AC-42 must stay
**NOT VERIFIED** until a human opens the pages. This is the single largest gap in the sign-off.

## 5. Retest after fixes

| Layer | Result |
|---|---|
| Automated suite | **228 checks, 43 suites, 0 failures** |
| Scripted walkthrough (67 assertions) | **all passed** |
| Adversarial probe (55 checks) | **55 passed, 0 failures** (was 52/3 before the BUG-001 fix) |
| Regression areas re-run after the fixes | search + filters, booking create/accept/cancel/rebook, messaging, notifications, admin suspend/reinstate, subject CRUD, review moderation, auth and session revocation |

## 6. QA verdict

**APPROVED**, with two conditions recorded honestly rather than waved through:

1. **AC-42 (responsive/visual) is unverified** — no browser was available. The markup and CSS are
   built for it, but nobody has looked at a rendered page.
2. **No critical or high-severity defect remains open.** The one medium defect found (BUG-001) is
   fixed and covered by regression tests; every deferred improvement is listed above with a reason.
