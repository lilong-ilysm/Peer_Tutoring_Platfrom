# Project Manager review

Reviewing the implementation at commit `df71b0c` against
[`01-product-spec.md`](01-product-spec.md) section 10.

**Method.** I read the implementation rather than the engineer's summary, ran the automated suite,
ran a scripted walkthrough of every page, and ran an adversarial probe specifically hunting for
500s, dead controls and filter quirks. Evidence for each verdict is named. Where I could not verify
something, I say so instead of assuming.

---

## Round 1

**Decision: REQUIRES CHANGES.** One acceptance criterion FAILS (AC-48, a control that does nothing)
and six are PARTIAL. Nothing here is architectural; the core journeys work and the security posture
is sound.

### 1.1 Requirements audit

Legend: **PASS** correct · **PARTIAL** partly done · **FAIL** missing/wrong · **NV** not verifiable here

| AC | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Register as student or tutor, land authenticated | PASS | `auth.test.js` registration suite; `http.test.js` tutor registration lands on `/profile` with the "not visible in search yet" checklist |
| 2 | Registration rejects bad input with field messages, no data loss | PASS | `http.test.js` "registration reports field errors and keeps the input"; duplicate-email case. (Was broken mid-build — the typed email was wiped — and fixed.) |
| 3 | Login and logout; logout invalidates server-side | PASS | `auth.test.js` session suite; walkthrough logout then `/dashboard` → 302 |
| 4 | No account enumeration | PASS | `auth.test.js` identical messages; `http.test.js` same for HTTP |
| 5 | Passwords never stored/echoed in plaintext | PASS | `security.test.js` hash contains no plaintext; `http.test.js` asserts the rejected password is not echoed back |
| 6 | Failed logins rate limited | PASS | `http.test.js` sees a 429 within 12 attempts |
| 7 | Suspended user cannot log in; sessions revoked | PASS | `auth.test.js` suspension cases; `routes/admin.js` calls `revokeSessionsOnSuspension` |
| 8 | Password change requires current password, revokes other sessions | PASS | `auth.test.js` keeps the current device, kills the other |
| 9 | Anonymous access redirects to login and returns afterwards | PASS | `http.test.js` asserts `?next=/bookings?scope=past` round-trip |
| 10 | Students cannot reach tutor/admin areas | PASS | `http.test.js` 403 for `/profile/availability`, `/profile/subjects`, `/admin`, `/admin/users` |
| 11 | No cross-user reads or writes | PASS | `http.test.js` foreign booking/conversation/API → 404 with no content leak; `bookings.test.js` service-level |
| 12 | CSRF required on every mutation | PASS | `http.test.js` missing token → 403, another visitor's token → 403 |
| 13 | Student profile create/edit persists | **PARTIAL** | Implemented (`saveStudentProfile`, form round-trips in the walkthrough) but **no automated test asserts persistence**. Needs a test. |
| 14 | Tutor profile, subjects, publish/unpublish | PASS | `availability.test.js`, `community.test.js`, factory uses the real services; publish gate enforced |
| 15 | Incomplete/unpublished tutors never appear in search; tutor told what is missing | PASS | `availability.test.js` "removing the last block un-publishes"; `bookings.test.js` refuses unpublished; `http.test.js` checklist text |
| 16 | Profile input validated per field | **PARTIAL** | Rules exist (`Validator.url/money/int`, campus/link requirement) but **untested**; a bad meeting link or negative rate has no regression guard |
| 17 | Anyone can list published tutors with rating/subjects/mode/rate | PASS | `http.test.js` search renders the seeded tutor; probe counted 6 cards |
| 18 | Keyword search matches name, headline, bio, subject | **PARTIAL** | Works, but `%` and `_` are passed straight into `LIKE`: probe shows `?q=%` returns **all 6** tutors and `?q=a%` returns 6. A user searching a literal `%` gets nonsense. **Issue PM-2** |
| 19 | All filters work individually and combined; sorting works | **PARTIAL** | Implemented and manually exercised; only `minRating` has an automated test. Combined-filter and per-filter coverage missing |
| 20 | Designed empty state; filter state survives reload/back | **PARTIAL** | Implemented (filters live in the query string, empty state has a "Clear filters" action) but no automated assertion |
| 21 | Malformed filters never error | PASS | `http.test.js` junk-filter case; probe `?minRating=abc&page=-42&day=99&sort=drop table` → 200 |
| 22 | Availability blocks and time off validated | PASS | `availability.test.js` (end ≤ start, too short, out-of-range weekday, overlap, cross-tutor removal) |
| 23 | Students only see genuinely bookable slots | PASS | `availability.test.js` lead time, window, time off, taken slots, cancelled slot released |
| 24 | Student can request a slot; booking appears for both | PASS | `bookings.test.js` + `http.test.js` full form round-trip |
| 25 | Tutor accepts/declines; student notified | PASS | `bookings.test.js` transitions; `http.test.js` accept then student sees "Confirmed" |
| 26 | Either party cancels with a reason; other notified; slot released | PASS | `bookings.test.js` cancel suite; `availability.test.js` cancelled slot returns |
| 27 | No double-booking, even concurrently | PASS | `bookings.test.js` second student refused; separate test proves the partial unique index blocks a service bypass |
| 28 | Past/nonexistent slots, untaught subjects, self-booking refused | PASS | `bookings.test.js` |
| 29 | Confirmed past session shows completed without manual action | PASS | `bookings.test.js` `settleElapsedBookings` |
| 30 | Only the tutor may accept | PASS | `bookings.test.js` + `http.test.js` student POST → 403 |
| 31 | Messaging works; participants only | PASS | `community.test.js`, `http.test.js` |
| 32 | Empty/over-long messages refused; content escaped | PASS | `community.test.js` limits; `http.test.js` `<script>` rendered escaped |
| 33 | Unread counts accurate and clear on read | PASS | `community.test.js` |
| 34 | Notifications reach the right recipient with a working link | PASS | `bookings.test.js` counts per user; `http.test.js` API scoping (stranger sees 0) |
| 35 | One review per completed session | PASS | `community.test.js` |
| 36 | No reviews on non-completed sessions or by non-participants | PASS | `community.test.js` |
| 37 | Rating aggregate matches visible reviews | PASS | `community.test.js` (3 reviews → 4.0; hide → 2 reviews; restore) |
| 38 | Dashboards show correct role-specific data with working actions | PASS | `http.test.js` student dashboard; walkthrough for tutor dashboard (requests, publish state, weekly hours) |
| 39 | Session history with statuses and filters | PASS | Walkthrough of all four scopes; `bookings.test.js` scoping |
| 40 | Admin can search users, suspend/reinstate, manage subjects; audit logged | **PARTIAL** | All pages render (probe: 5/5 → 200) and `recordAudit` is called on every mutation, but the suspend/reinstate/subject flows have **no automated test** |
| 41 | Admin can hide a review; rating updates | PASS | `community.test.js` |
| 42 | Usable at 320/768/1280 with no overflow | **NV** | No browser in this environment. CSS implements the breakpoints (nav wraps, tables restack, single-column grids) but nobody has *looked* at it |
| 43 | Loading/empty/error states everywhere; explicit feedback | **PARTIAL** | Empty, error, success and invalid-input states are all present and used. "Loading" is limited to the submit-once/aria-busy guard; server-rendered navigation has no progress affordance |
| 44 | Keyboard reachable, visible focus, real labels, one `h1` | **PARTIAL** | Labels wired with `aria-describedby`/`aria-invalid`; focus ring defined; probe confirms exactly one `h1` on landing/search/dashboard. But `tabs()` puts `role="tablist"`/`role="tab"` on plain links with no tabpanel, which misleads screen readers (**PM-4**), and the bell badge count is not announced (**PM-5**) |
| 45 | Data persists across restarts | PASS | The server was stopped and restarted twice against the same SQLite file; seeded users, bookings and messages survived |
| 46 | Fresh clone runs from documented steps; no secrets committed | PASS | `npm run seed` then `npm start` is exactly what I ran; `git status` shows `.env` and `data/` ignored, and the 72 committed files contain no credentials |
| 47 | Test suite passes and covers the named areas | PASS | 133 checks, 8 suites, 0 failures |
| 48 | No control that does nothing | **FAIL** | An administrator viewing `/bookings/:id` is shown **"Cancel this session"**; submitting it returns 403 and changes nothing (**PM-1**) |
| 49 | Friendly 500 page, stack only in the log | **PARTIAL** | Implemented (`errorPage`, `logger.fault`); never triggered in a test, so unproven |
| 50 | List pages under 150ms with seed data | PASS | Request log: 0.8–5.2ms per page |

**Totals: 38 PASS · 7 PARTIAL · 1 FAIL · 1 not verifiable.**

### 1.2 Code review

What is genuinely good, and worth keeping:

- **Layering holds.** No route touches SQL; services own the rules. I checked for leakage and found none.
- **Two-layer double-booking defence** (transaction + partial unique index) with a test that bypasses
  the service to prove the index. That is the difference between hoping and knowing.
- **Escape-by-default templates.** XSS requires an explicit `raw()`. Grep found no `style="` anywhere,
  so the CSP with no `unsafe-inline` is real rather than aspirational.
- **Lazy settlement** of elapsed bookings avoids a scheduler and closes the "pending forever" hole,
  including notifying both parties when a request expires.
- **Derived ratings** recomputed on every write, so moderation is instantly reflected.
- Config fails fast on bad input; migrations run inside a transaction.

Findings:

| ID | Priority | Finding | Where |
|---|---|---|---|
| PM-1 | **HIGH** | Admins see participant-only controls (cancel, and the decline form on pending bookings) that the service correctly refuses. Either the control or the permission is wrong; the control is. Give admins an explicitly read-only view. | `web/views/pages/bookings.js` (`bookingDetailPage`, `sessionCard`) |
| PM-2 | **MEDIUM** | `LIKE` metacharacters in the search keyword are not escaped, so `%`/`_` behave as wildcards. Search must match what the user typed. | `services/tutors.js` `searchTutors` |
| PM-3 | **MEDIUM** | Each individual review renders "★★★★★ 5.0 (1 review)". Reusing the aggregate component for a single rating reads as if every review has its own review count. | `views/components.js` `stars`, used by `pages/tutors.js` |
| PM-4 | LOW | `tabs()` applies `role="tablist"`/`role="tab"`/`aria-selected` to navigation links with no tabpanel. Wrong ARIA is worse than none. Use a `nav` with `aria-current`. | `views/components.js` `tabs` |
| PM-5 | LOW | The notification badge is a bare number with no accessible description; the icon's label says only "Notifications". | `views/layout.js` |
| PM-6 | LOW | `listBookingsForUser` silently applies **no** ownership filter for an unrecognised role (the `admin` path). Unreachable today because `/bookings` is student/tutor-only, but it is a "one route away from a data leak" shape. Make it explicit. | `services/bookings.js` |
| PM-7 | LOW | Test coverage gaps behind the PARTIAL verdicts above: student profile persistence (AC-13), profile field validation (AC-16), per-filter and combined search (AC-19/20), admin suspend/reinstate/subject/audit flows (AC-40), and the 500 renderer (AC-49). | `tests/` |

### 1.3 UX review — "would a student understand this?"

Walking it as Maya (needs help with Calculus, test in three weeks):

- Landing page states the value in one line and shows there is real supply (tutor count, subjects with
  counts, top tutors). **Good.**
- Search: filters read in plain language ("Available on", "Max rate", "Minimum rating"), and the
  subject dropdown shows how many tutors teach each subject, which prevents dead-end filtering. **Good.**
- Tutor profile: rating, subjects with levels, "what you get" and a real calendar. The lead-time and
  "the tutor confirms before it is booked" sentences set expectations before the click. **Good.**
- Request form: the slot summary sits beside the form, and the status the booking will have
  (`Pending`) is shown before submitting. **Good.**
- After booking: the detail page shows a timeline, so "what is happening with my request" is always
  answerable. **Good.**
- Cancelling demands a reason and warns that the other person sees it. **Good** — this is the
  difference between a platform people trust and a no-show factory.
- Every empty state names the next action rather than saying "no data".

Where the experience is weaker:

- **UX-1 (MEDIUM):** a student who has *no* pending requests and *no* sessions sees three separate
  empty states stacked down the dashboard. Acceptable, but it reads as an empty room. Worth folding
  into one "get started" panel later. *(Deferred, logged, not blocking.)*
- **UX-2 (LOW):** the search keyword field only applies on "Apply filters" while dropdowns
  auto-apply. Mildly inconsistent, though the alternative (submitting on every keystroke) is worse.
  *(Deferred.)*
- **UX-3 (LOW):** PM-3 above is really a UX defect; fixing it removes the confusing "(1 review)".

### 1.4 Required before QA

Fix **PM-1** (FAIL), **PM-2**, **PM-3**, and close the **PM-7** coverage gaps so the PARTIAL verdicts
can be re-judged on evidence rather than reading. PM-4/5/6 are cheap and should go in the same pass.

---

## Round 2

Re-reviewed after the engineer's fixes (see [`03-qa-report.md`](03-qa-report.md) for the QA cycle
that followed).

| ID | Status | Verification |
|---|---|---|
| PM-1 | **Fixed** | `bookingDetailPage`/`sessionCard` now render participant actions only when the viewer is the student or the tutor; an admin gets a read-only notice instead. Regression test `http.test.js` "an admin sees a read-only view of a booking" asserts the control is absent and that a forced POST is still refused. |
| PM-2 | **Fixed** | `searchTutors` escapes `%`, `_` and `\` and uses `ESCAPE '\'`. Test: `search.test.js` "wildcard characters are treated literally" — `?q=%` now returns 0 tutors, `?q=Naledi` still returns 1. |
| PM-3 | **Fixed** | `stars()` takes a `compact` option; individual reviews render stars plus the numeric rating only. Asserted in `search.test.js` rendering checks. |
| PM-4 | **Fixed** | `tabs()` renders `<nav aria-label>` + `aria-current="page"`; no ARIA tab roles remain. |
| PM-5 | **Fixed** | The bell now carries an `aria-label` that includes the unread count, plus an `sr-only` description that updates with the badge. |
| PM-6 | **Fixed** | `listBookingsForUser` throws on an unsupported role rather than returning unscoped rows; covered by a test. |
| PM-7 | **Fixed** | Four new suites (`search`, `profile`, `admin`, `views`) plus an added HTTP case: student profile persistence, tutor profile field validation, every search filter individually and combined, sorting, pagination, empty-state and escaping in the rendered search page, admin suspend/reinstate/subject/review/audit flows, and the error renderer. Suite grew from **133 to 223 checks** (42 suites), all passing. |

Re-audit of the previously PARTIAL criteria: **AC-13, AC-16, AC-18, AC-19, AC-20, AC-40, AC-48, AC-49
now PASS** on test evidence. AC-43 remains PARTIAL by design (no navigation progress bar on a
server-rendered app; mutations do show a pending state) and **AC-42 remains NOT VERIFIED** — that
needs a human with a browser.

**Decision at this point: APPROVED FOR QA.**

---

## Round 3 — after the QA cycle

QA ran its own adversarial pass (see [`03-qa-report.md`](03-qa-report.md)) and found one defect I had
missed, plus one behavioural gap:

| From QA | Severity | Outcome |
|---|---|---|
| **BUG-001** — out-of-range numeric filters (`?subject=0`, `?day=99`, `?day=-3`) were clamped, so search silently applied a filter the visitor never chose and showed 2 of 6 tutors as if that were the whole truth | MEDIUM | **Fixed.** `coerceInt`/`coerceFloat` gained a `clamp` option; identifiers, weekday and rating/rate now discard out-of-range input. Covered by a unit test and an HTTP test that counts result cards. Re-probed: 6 of 6 in every case. |
| **IMP-1** — messages could be sent into a suspended user's conversation, where they could never be read | LOW | **Fixed.** `sendMessage` refuses with a clear explanation; test added. |
| IMP-2, IMP-3, IMP-4, IMP-5, IMP-6 | LOW/INFO | Deferred with reasons recorded in the QA report. I agree with each deferral; none blocks release. |

Final state of the evidence I care about as PM:

- Automated suite: **228 checks, 43 suites, 0 failures.**
- Scripted walkthrough: 67 assertions, all passing.
- Adversarial probe: 55 checks, all passing (was 52/3 before BUG-001 was fixed).
- Requirements audit: **48 of 50 PASS, 1 PARTIAL by design (AC-43), 1 NOT VERIFIED (AC-42).**

**Final decision: APPROVED.** Two things go into the final report as open items rather than being
quietly dropped: AC-42 needs a human with a browser, and AC-43's "loading affordance" is limited to
the submit-once state on mutations, which I accept for a server-rendered application.
