# PeerLearn — Product & Technical Specification

**Owner:** Project Manager / Product Designer
**Status:** Baseline v1.0 (approved for implementation)
**Document purpose:** the single functional source of truth for the implementation. The Software Engineer builds against this; the Project Manager audits against Section 10; QA tests against Sections 3–10.

---

## 0. Assumptions (IMPORTANT)

No formal assignment brief was supplied for this project (the requirements section was left as a placeholder). The following assumptions were made in order to produce a coherent product. **If any assumption is wrong, this document changes first, then the code.**

| # | Assumption |
|---|---|
| A1 | The platform serves a single institution (a university/college). Users are members of that institution. |
| A2 | Tutoring is **peer-to-peer**: tutors are students who have already passed a subject. There is no "professional tutor" tier. |
| A3 | **No money moves through the platform.** Sessions are free or settled off-platform. Tutors may publish an indicative rate, but there is no payment processing. This removes payments, invoicing, refunds and PCI concerns from scope. |
| A4 | Sessions happen either in person (on campus) or online via a meeting link the tutor supplies. The platform does **not** host video calls. |
| A5 | Email/SMS delivery is out of scope. Notifications are in-app only. |
| A6 | The institution operates in one timezone, configured per deployment (`APP_TIMEZONE`). All availability and session times are expressed in that zone and labelled with it. |
| A7 | Expected scale: low thousands of users, tens of thousands of bookings. A single-node deployment with an embedded database is sufficient. |
| A8 | Modern evergreen browsers; the platform must still be usable on a 320px-wide phone. |

---

## 1. Problem, users, value

### 1.1 The problem

Students who are struggling in a subject and students who could help them cannot find each other. The current reality on most campuses:

- Help is brokered informally through group chats, notice boards and word of mouth — discovery is luck-based.
- There is no way to tell whether a would-be tutor is any good.
- Scheduling is a manual back-and-forth ("are you free Tuesday?") that frequently collapses.
- Nobody has a record of what happened: no history, no accountability, no evidence for the department that peer tutoring is worth supporting.

### 1.2 Target users

| Persona | Description | Primary goal |
|---|---|---|
| **Maya — the student seeking help** | 1st/2nd year, one subject is hurting her GPA, has a test in 10 days. | Find someone credible who can help *this week*, and lock in a time. |
| **Daniel — the peer tutor** | 3rd year, got a distinction in the subject, wants tutoring experience and a light, controllable workload. | Advertise what he can teach, control exactly when he is available, and not be messed around. |
| **Thandi — the programme administrator** | Runs the faculty's academic support office. | Keep the platform clean and safe (no abuse, no fake tutors), and report on usage. |

### 1.3 Jobs to be done

- **Student:** "Find a tutor for *this* subject at *this* level who is free at a time I can make, and book them without a 20-message negotiation."
- **Tutor:** "Publish what I teach and when I'm free, approve requests I want, decline the ones I don't, and build a visible reputation."
- **Admin:** "See what's happening, control the subject catalogue, and remove bad actors or abusive reviews."

### 1.4 Non-goals (explicitly out of scope for v1)

Payments/escrow, video conferencing, group sessions, course content or file libraries, email/SMS delivery, mobile native apps, calendar sync (Google/Outlook), AI matching, real-time websockets (in-app polling is sufficient), multi-institution tenancy.

---

## 2. Scope decisions

Features are graded. Everything in **CORE** and **SECONDARY** is in v1 scope. **OPTIONAL** is explicitly deferred and must not be half-built.

### 2.1 CORE — the platform is broken without these

| Feature | What it does | Why it is needed | Who uses it | Interaction |
|---|---|---|---|---|
| **Accounts & authentication** | Registration as student or tutor, login, logout, server-side sessions, password hashing. | Everything else depends on knowing who the actor is. Bookings and messages are personal data. | All | Email + password forms. Role is chosen at registration. |
| **Role-based authorisation** | Students, tutors and admins can only reach and mutate what belongs to them. | The one requirement whose failure is a data breach, not a bug. | All (enforced server-side) | Invisible when correct: 403/404 and hidden nav when not. |
| **Profiles** | Student profile (programme, year, goals). Tutor profile (headline, bio, subjects + level taught, mode, campus/meeting link, indicative rate, publish toggle). | A booking is an act of trust; the profile is the evidence. Tutors are unfindable until published. | Student, Tutor | Edit forms in settings; tutor profile has a public view. |
| **Subject catalogue** | Admin-curated list of subjects with codes and categories. | Free-text subjects destroy search. A shared vocabulary is what makes filtering work. | Admin maintains; all consume | Select lists; admin CRUD screen. |
| **Tutor search + filters** | Keyword search over name/headline/bio/subject, filtered by subject, level, mode, minimum rating, max rate and day-of-week availability; sortable; paginated. | The core discovery job. Without this the platform is a directory nobody can navigate. | Student | Search page with a filter sidebar; filters are URL state so results are shareable/back-button safe. |
| **Availability management** | Tutor defines recurring weekly blocks (weekday + start/end). System expands them into concrete bookable slots for a rolling window, minus booked slots, minus time-off, minus anything inside the booking lead time. | The mechanism that removes the scheduling back-and-forth. | Tutor defines, Student consumes | Tutor adds/removes blocks and date-based time off; student sees only real, bookable slots. |
| **Session booking lifecycle** | Student requests a slot (subject + note) → `pending`. Tutor accepts (`confirmed`) or declines (`declined`). Either party cancels with a reason (`cancelled`). Past confirmed sessions become `completed`. | The transaction at the heart of the product. | Student, Tutor | Slot picker → request; tutor acts from dashboard/booking detail. |
| **Double-booking prevention** | A tutor can never hold two active (pending/confirmed) sessions that overlap. Enforced in a transaction *and* by a database constraint. | Two students arriving for the same slot is a trust-destroying failure. | System | Losing request fails with a clear "slot no longer available" message. |
| **Dashboards** | Student: next session, pending requests, unread messages, recent activity. Tutor: requests awaiting response, upcoming sessions, availability summary, rating. | The daily landing surface; answers "what needs me now?". | Student, Tutor | Read-only summary with direct actions. |
| **Session history** | Every past session with status and outcome, filterable. | Accountability, and the gate for reviews. | Student, Tutor, Admin | Filterable list. |

### 2.2 SECONDARY — significant value, in v1 scope

| Feature | What it does | Why | Who | Interaction |
|---|---|---|---|---|
| **Messaging** | One conversation per student–tutor pair. Send/read messages, unread counts. Only participants may read. | Real tutoring needs coordination ("bring chapter 4"). Keeping it on-platform means it is moderatable and doesn't leak phone numbers. | Student, Tutor | Inbox + thread view, poll for new messages. |
| **In-app notifications** | Events (request received, accepted, declined, cancelled, new message, review received) create notifications with a deep link. Unread badge. | Without this the tutor never learns a request is waiting and the loop stalls. | Student, Tutor | Bell + notifications page; click marks read and navigates. |
| **Reviews & ratings** | After a `completed` session the student may leave one 1–5 star review with a comment. Tutor aggregate rating is derived, never hand-edited. | The credibility signal that makes an unknown peer bookable. Gating on completion is what stops it becoming fiction. | Student writes, everyone reads | Prompt on completed session; shown on tutor profile and search results. |
| **Admin console** | Platform stats, user list with search, suspend/reinstate users, subject CRUD, review moderation (hide), audit log of admin actions. | Somebody has to be able to remove the abusive user at 11pm. | Admin | Dedicated console, reachable only by admins. |

### 2.3 OPTIONAL — deliberately deferred

Rescheduling (propose a new time on an existing booking — v1 answer is cancel and rebook), tutor replies to reviews, favourite/saved tutors, calendar export, group sessions, verification of academic transcripts, report-a-user flow, dark mode.

**Rejected on purpose:** payments, video calls, email delivery, file uploads (avatars are generated initials — an upload pipeline is disproportionate cost and an attack surface for v1).

---

## 3. User journeys

### 3.1 Student — from problem to booked session

```
Landing page (understands the product, sees subjects)
  → Register (role: student)
  → Complete profile (programme, year, goals)          [skippable, nudged on dashboard]
  → Search tutors  ──filter: subject / level / mode / rating / rate / day
  → Compare result cards (rating, subjects, rate, mode)
  → Open tutor profile (bio, subjects+levels, reviews, live availability)
  → Pick a slot  → choose subject + write a note  → Submit request
  → Booking = PENDING ("waiting for Daniel to accept")
  → Notification: accepted / declined
      ├─ accepted  → session appears in "Upcoming" with location or meeting link
      │                → message the tutor if needed
      │                → attend  → session auto-completes after end time
      │                → Review prompt → submit 1–5 stars + comment
      └─ declined  → reason shown → back to search (or message the tutor)
```

Escape hatches at every step: cancel a pending request, cancel a confirmed session with a reason, message before/after booking.

### 3.2 Tutor — from sign-up to reputation

```
Landing page
  → Register (role: tutor)
  → Build tutor profile (headline, bio, mode, campus/meeting link, indicative rate)
  → Add subjects + the level they can teach at
  → Set weekly availability blocks
  → PUBLISH profile                    [gated: profile is only searchable when it has
  |                                      a headline, ≥1 subject and ≥1 availability block]
  → Notification: new request
  → Review the request (student, subject, time, note)
      ├─ Accept  → confirmed → conduct session → session completes → receive review
      └─ Decline (with reason) → student notified, slot released
  → Manage load: add/remove availability, mark time off, unpublish
```

### 3.3 Admin

```
Login → Admin console
  → Stats (users, tutors published, bookings by status, reviews)
  → Users: search → suspend (sessions revoked, cannot log in) / reinstate
  → Subjects: create / rename / retire
  → Reviews: hide abusive review (rating aggregate recalculated)
  → Audit log of every admin action
```

### 3.4 Usability problems identified during flow design, and the decisions taken

| Problem | Decision |
|---|---|
| A tutor with no subjects or no availability would appear in search and be unbookable — a dead end that erodes trust. | **Publication gate.** A tutor profile cannot be published (and is therefore invisible) without a headline, ≥1 subject and ≥1 availability block. The tutor is told exactly what is missing. |
| Two students can request the same slot; the second acceptance would double-book. | Slot generation excludes slots already held by an active booking, and booking creation re-checks for overlap inside a transaction with a unique DB index as backstop. The loser gets an explicit message, not a stack trace. |
| A student could book a slot starting in 5 minutes. | Configurable **booking lead time** (default 2h). Slots inside the lead time are not offered. |
| "Completed" would never happen if it needed a human to click it. | Sessions transition `confirmed → completed` automatically once the end time has passed (lazily evaluated on read, so no scheduler is required). |
| Reviews of sessions that never happened would be fiction. | A review requires a `completed` booking that belongs to the reviewer, and exactly one review per booking. |
| Empty dashboards for brand-new users look broken. | Every list has a designed empty state with the next best action ("Find a tutor", "Add your first availability block"). |
| A student cancelling 3 minutes before the session, silently, wastes the tutor's time. | Cancellation requires a reason, notifies the other party, and is recorded permanently in history. |
| Timezones: a tutor entering "Mon 09:00" while a student reads a converted time invites no-shows. | Single platform timezone, displayed with its label everywhere. Honest and unambiguous. |

---

## 4. Site map

Access legend: **P** public · **S** student · **T** tutor · **A** admin · **auth** any signed-in user

| Route | Page | Access | Purpose | Key components | Primary actions |
|---|---|---|---|---|---|
| `/` | Landing | P | Explain the product, drive registration, show subject breadth. | Hero, how-it-works (student/tutor), subject chips, featured tutors, CTA | Register, Log in, Browse tutors |
| `/register` | Registration | P | Create an account and pick a role. | Role selector, form with inline validation, password strength rules | Create account |
| `/login` | Login | P | Authenticate. | Form, error surface, rate-limit notice | Log in |
| `/logout` | — | auth | End session (POST only). | — | Log out |
| `/tutors` | Tutor search | P (book requires login) | The discovery surface. | Search bar, filter sidebar, sort, result cards, pagination, empty state | Filter, sort, open profile |
| `/tutors/:id` | Tutor profile | P | The decision surface. | Header (name, rating, rate, mode), bio, subjects+levels, availability picker, reviews | Request session, Message |
| `/bookings/new?tutor=&slot=` | Request session | S | Confirm the details of a request. | Slot summary, subject select, note, guidance | Submit request |
| `/dashboard` | Dashboard | S / T | "What needs me now?" Role-specific. | Stat tiles, next session, pending requests, unread messages, profile-completeness nudge | Accept/decline, open session, jump to search |
| `/bookings` | Sessions | S / T | All sessions, upcoming and past. | Status filter tabs, session cards, empty states | Open, cancel |
| `/bookings/:id` | Session detail | participants + A | Everything about one session and the actions available on it. | Timeline of status changes, participant card, note, location/link, review block | Accept, decline, cancel, review, message |
| `/messages` | Inbox | auth | All conversations, most recent first. | Conversation list with unread badges, empty state | Open thread |
| `/messages/:id` | Thread | participants | Talk to the other party. | Message list, composer, participant header, polling | Send message |
| `/notifications` | Notifications | auth | Catch up on everything that happened. | Grouped list, read/unread, mark all read | Open, mark read |
| `/profile` | My profile | auth | Edit identity + role-specific profile. | Account form, student or tutor form, password change | Save, change password |
| `/profile/subjects` | My subjects | T | Manage taught subjects + levels. | Current subjects, add form | Add, remove |
| `/profile/availability` | My availability | T | Control the calendar. | Weekly grid, block add/remove, time off, publish state + missing-requirements checklist | Add/remove block, add/remove time off, publish/unpublish |
| `/admin` | Admin overview | A | Platform health. | Stat tiles, recent activity | Navigate |
| `/admin/users` | Users | A | Moderate people. | Search, role/status filters, table, actions | Suspend, reinstate |
| `/admin/subjects` | Subjects | A | Own the vocabulary. | Table, create form | Create, rename, retire |
| `/admin/reviews` | Reviews | A | Moderate content. | Review list, hide action | Hide/unhide |
| `/admin/audit` | Audit log | A | Accountability for admin power. | Chronological log | — |
| `403`, `404`, `500` | Error pages | — | Fail clearly, offer a way out. | Explanation + primary link | Navigate home |

Pages deliberately **not** built: separate "settings" page (folded into `/profile`), separate "how it works" page (a section on the landing page), tutor public list of their own reviews (part of the profile).

---

## 5. UI / UX direction

**Design intent:** calm, credible, academic — closer to a well-made university service than a consumer marketplace. Content first, chrome second. No decorative motion, no dark patterns, nothing that looks clickable but isn't.

### 5.1 Visual language

- **Palette:** deep indigo primary (`#3f37c9`-family) for actions and identity; slate neutrals for text and surfaces; semantic green/amber/red/blue reserved *exclusively* for status (confirmed / pending / cancelled-declined / completed). Status colour is never used decoratively, so a colour always means the same thing.
- **Accessibility of colour:** body text ≥ 4.5:1 against its background; large text and UI borders ≥ 3:1. Status is always carried by **text label + shape**, never colour alone.
- **Typography:** system font stack (zero webfont latency, native feel). One type scale, 6 steps. Body 16px minimum, 1.6 line-height, measure capped ~70ch.
- **Spacing:** 4px base scale (4/8/12/16/24/32/48/64). Consistent vertical rhythm between sections.
- **Radii & elevation:** 10px cards, 8px controls; one soft shadow for raised surfaces, one for popovers. No heavy borders plus shadow at once.

### 5.2 Components

Cards (tutor result, session, conversation, stat tile), badges (status, level, mode), avatar (generated initials with a deterministic colour), star rating (accessible: text equivalent `4.6 out of 5, 12 reviews`), forms (label above input, help text, inline error text tied to the field via `aria-describedby`, `aria-invalid`), buttons (primary / secondary / ghost / danger, one primary per view), tabs (filters), pagination, alert banners (success/error/info), modal-free confirmations (destructive actions use a dedicated confirm view or an inline reason form — no `confirm()` dialogs), empty states (icon + one line + one action), skeleton/pending states.

### 5.3 Layout & navigation

- Desktop: sticky top bar (logo, main nav, search, notification bell, avatar menu). Content max-width 1120px. Search page uses a 280px filter rail + fluid results grid.
- Tablet: filter rail collapses into a disclosure above results.
- Mobile (≤ 640px): top bar collapses to logo + bell + menu toggle; nav becomes a full-width disclosure; grids collapse to one column; tables become stacked definition rows; all touch targets ≥ 44px; nothing horizontally scrolls.

### 5.4 States (mandatory for every data surface)

| State | Requirement |
|---|---|
| Loading | Any request > 300ms shows a pending affordance; buttons disable on submit so double-clicks can't double-book. |
| Empty | Explains *why* it's empty and offers the next action. |
| Error | Plain language, what happened, what to do next. Never a raw stack trace or SQL error. |
| Success | Confirmation banner after every mutation, on the page the user lands on. |
| Invalid input | Field-level messages, values preserved (a rejected form never wipes what the user typed), focus moved to the first error. |
| Unauthorised | 403 page explaining the situation; never a blank screen. |

### 5.5 Accessibility baseline

Semantic landmarks (`header`/`nav`/`main`/`footer`), one `h1` per page and a sane heading order, skip-to-content link, visible focus ring on every interactive element, full keyboard operability, form labels always present (never placeholder-as-label), `aria-live` for async status, `<time datetime>` for machine-readable times, alt text/aria-labels on icon-only controls, and no reliance on hover to reveal essential actions.

---

## 6. Technical plan

The engineer may deviate with a written justification (see `docs/04-engineering-notes.md`).

| Concern | Recommendation | Reasoning |
|---|---|---|
| Runtime | **Node.js 22+ (24 recommended)** | Verified present in the environment. One language across server and browser. |
| Server | **`node:http` + a small purpose-built router** | The app has ~30 routes and no exotic middleware needs. Node 22+ ships an HTTP server, a SQLite driver, a test runner and a crypto library, so a framework buys little here and costs a dependency tree, a lockfile and a supply-chain surface. **Zero runtime dependencies** is a defensible engineering position for a project this size and makes the checkout reproducible and instantly runnable. |
| Rendering | **Server-rendered HTML** via an auto-escaping tagged-template layer, progressively enhanced with a small vanilla JS bundle | Every page is content that benefits from arriving complete: fast first paint, works without JS, no build step, and XSS is prevented *by construction* because interpolation escapes by default. An SPA would add a toolchain and a second data model for no user-visible gain. |
| Database | **SQLite via built-in `node:sqlite`**, WAL mode, foreign keys ON | Relational data with real constraints (the schema *is* the integrity guarantee), single-file operations, no native compilation, no server to run. Fits assumption A7 with room to spare; migration to Postgres later is a driver + dialect change because all access goes through one data layer. |
| Schema management | Numbered, forward-only SQL migrations applied at boot inside a transaction, tracked in a `schema_migrations` table | Reproducible from an empty file; no ORM magic. |
| API style | Server-rendered forms (POST + redirect, so the back button behaves) for primary flows; a small JSON API under `/api/*` for polled/incremental UI (notifications, messages, availability slots) | Uses the right tool per interaction instead of forcing everything through one style. |
| Authentication | Opaque random session token in an `HttpOnly; SameSite=Lax; Path=/` cookie (`Secure` in production), with only the **SHA-256 hash** stored server-side; sliding expiry; all sessions revoked on password change or suspension | Server-side sessions can be revoked instantly, which JWTs cannot. Storing the hash means a leaked DB dump does not yield usable sessions. |
| Passwords | **scrypt** (Node built-in, N=16384/r=8/p=1) with a 16-byte per-user salt, constant-time verification | Memory-hard KDF from the standard library; no dependency, no hand-rolled crypto. |
| CSRF | Per-session token, hidden field on every state-changing form and `X-CSRF-Token` on every unsafe API call, verified constant-time | `SameSite=Lax` alone is not a defence for POST from a hostile page in every browser. |
| Authorisation | Central guards (`requireAuth`, `requireRole`) plus a resource-ownership check inside each service — never "the UI didn't show the button" | Defence in depth; the service layer is the enforcement point, the UI is only a hint. |
| Validation | One declarative validator used by both page and API handlers; type, presence, length, format, enum and range checks; trims and normalises before persisting | A single place to reason about what enters the database. |
| State management (client) | None. Progressive enhancement only (poll notifications/messages, submit-once guards, relative time rendering, filter rail disclosure) | No client state means no client/server divergence bugs. |
| Static assets | Served from `src/public` with correct MIME types, long-lived caching for versioned assets, and path-traversal protection | |
| File storage | None (generated initial avatars) | Avoids an upload/scanning/storage pipeline that v1 does not need (A5/§2.3). |
| Testing | Built-in `node:test` — unit tests for time/slot/validation/security logic and HTTP-level integration tests against a real ephemeral server + temp database | Tests the app the way a user hits it, with zero test dependencies. |
| Security headers | CSP (`default-src 'self'`, no inline script or style), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS in production | |
| Rate limiting | Fixed-window in-memory limiter on login, registration, password change, messaging and booking creation | Cheap brute-force and spam protection appropriate to a single node. |
| Configuration | `.env` loaded by a tiny built-in parser; `.env.example` committed; **no secrets in the repo**; the app refuses to start in production without `SESSION_SECRET` | |
| Deployment | Single Node process behind a TLS-terminating reverse proxy; database file on a persistent volume; `npm start` | Matches A7. |
| Logging | Structured single-line request log (method, path, status, duration) with no PII in messages; errors logged with a stack, never leaked to the client | |

### 6.1 Data model (target)

```
users(id, email UNIQUE, password_hash, role[student|tutor|admin], full_name, status[active|suspended],
      created_at, updated_at, last_login_at)
student_profiles(user_id PK→users, programme, year_of_study, bio, goals, updated_at)
tutor_profiles(user_id PK→users, headline, bio, mode[online|in_person|both], campus, meeting_link,
      hourly_rate_cents, years_experience, is_published, rating_avg, rating_count, updated_at)
subjects(id, code UNIQUE, name UNIQUE, category, is_active)
tutor_subjects(tutor_id→users, subject_id→subjects, level[intro|intermediate|advanced], PK(tutor_id,subject_id))
availability_blocks(id, tutor_id→users, weekday 0-6, start_minute, end_minute, created_at,
      UNIQUE(tutor_id, weekday, start_minute))
tutor_time_off(id, tutor_id→users, date, note, UNIQUE(tutor_id, date))
bookings(id, student_id→users, tutor_id→users, subject_id→subjects, starts_at, ends_at,
      status[pending|confirmed|declined|cancelled|completed], mode, location, student_note,
      tutor_note, cancelled_by→users, cancel_reason, created_at, updated_at)
      + partial UNIQUE(tutor_id, starts_at) WHERE status IN ('pending','confirmed')
conversations(id, student_id→users, tutor_id→users, last_message_at, UNIQUE(student_id,tutor_id))
messages(id, conversation_id→conversations, sender_id→users, body, created_at, read_at)
reviews(id, booking_id UNIQUE→bookings, student_id→users, tutor_id→users, rating 1-5, comment,
      is_hidden, created_at)
notifications(id, user_id→users, type, title, body, link, read_at, created_at)
sessions(token_hash PK, user_id→users, csrf_token, created_at, expires_at, ip, user_agent)
audit_log(id, actor_id→users, action, target_type, target_id, meta, created_at)
schema_migrations(version PK, applied_at)
```

Integrity rules: every FK declared and enforced; `CHECK` constraints on every enum, on `end > start`, and on rating range; indexes on every column used for filtering or joining (`bookings(tutor_id, starts_at)`, `bookings(student_id, starts_at)`, `messages(conversation_id, created_at)`, `notifications(user_id, read_at)`, `tutor_subjects(subject_id)`); rating aggregates derived from `reviews` and recomputed on write, never edited directly; timestamps stored as UTC ISO-8601 strings.

---

## 7. Business rules (testable)

1. Email is unique, case-insensitively; passwords ≥ 10 characters.
2. A user has exactly one role. Roles are not self-serve upgradable in v1. Admins are provisioned by seed/CLI only.
3. A suspended user cannot log in, and existing sessions are revoked immediately.
4. Only a `tutor` may own a tutor profile, subjects, availability or time off.
5. A tutor profile becomes searchable only when `is_published` and it has a headline, ≥1 subject and ≥1 availability block.
6. Slots are `SLOT_MINUTES` long (default 60), aligned to the start of an availability block, generated for `BOOKING_WINDOW_DAYS` ahead (default 21), and excluded if in the past, inside `BOOKING_LEAD_HOURS` (default 2), on a time-off date, or overlapped by an active booking.
7. A student may not book themselves; a tutor cannot request a session.
8. A booking request must reference a subject the tutor actually teaches.
9. A tutor may have at most one active (pending/confirmed) booking per slot; concurrent requests for the same slot: first wins, second gets an explicit conflict message.
10. A student may not hold more than `MAX_ACTIVE_REQUESTS` (default 5) pending requests at once.
11. Only the tutor may accept/decline, and only from `pending`.
12. Either participant may cancel a `pending` or `confirmed` booking; a reason is required; the other party is notified.
13. A `confirmed` booking whose end time has passed is `completed`. Terminal statuses never change.
14. A review requires: reviewer is the booking's student, booking is `completed`, no existing review for that booking, rating 1–5.
15. A hidden review is excluded from public display and from rating aggregates.
16. Only the two participants may read or post in a conversation. Message body 1–2000 characters after trimming.
17. Notifications are only ever visible to their owner.
18. All times displayed with the platform timezone label.

---

## 8. Non-functional requirements

- **Security:** no secrets in the repository; hashed passwords; hashed session tokens; CSRF on every mutation; parameterised SQL only; output escaped by default; authorisation enforced server-side on every request; security headers set; no user-controlled data in error pages.
- **Performance:** typical page renders in < 150ms locally; search stays indexed; no N+1 query patterns on list pages.
- **Reliability:** invalid input never 500s; a failed migration aborts boot rather than running on a half-migrated schema.
- **Maintainability:** layered (routes → services → data), no route handler touching SQL directly, no duplicated business rules, functions small enough to read whole.
- **Documentation:** README with setup, environment variables, scripts, seeded demo logins, architecture summary and known limitations.

---

## 9. Delivery plan

| Milestone | Contents |
|---|---|
| M1 | Repo scaffold, config, migrations, core libs (http/router/security/validate/time), layout + design system |
| M2 | Auth, sessions, CSRF, authorisation, profiles |
| M3 | Subjects, tutor profiles, search + filters, availability + slot generation |
| M4 | Bookings lifecycle, notifications, messaging, reviews, dashboards, admin console |
| M5 | Seed data, automated tests, engineer self-verification, first push |
| M6 | PM audit → fixes → QA cycle → fixes → re-audit → re-test |

---

## 10. Acceptance criteria

Each is objectively verifiable. The project is not complete until every **MUST** passes.

### Authentication & accounts
- **AC-1 (MUST)** A visitor can register as a student or a tutor and lands authenticated.
- **AC-2 (MUST)** Registration rejects: invalid email, duplicate email (case-insensitive), password < 10 chars, mismatched confirmation, missing name — with field-level messages and no data loss.
- **AC-3 (MUST)** A registered user can log in and log out. Logout invalidates the session server-side.
- **AC-4 (MUST)** Wrong password and unknown email produce the same generic message (no account enumeration).
- **AC-5 (MUST)** Passwords are never stored or logged in plaintext and never appear in any response.
- **AC-6 (MUST)** Repeated failed logins from one source are rate-limited.
- **AC-7 (MUST)** A suspended user cannot log in and is signed out of existing sessions.
- **AC-8 (MUST)** A user can change their password with the current password, which revokes other sessions.

### Authorisation
- **AC-9 (MUST)** Unauthenticated access to any authenticated route redirects to login and returns to the intended page after login.
- **AC-10 (MUST)** A student cannot reach tutor-only pages/actions or the admin console (403).
- **AC-11 (MUST)** A user cannot read or mutate another user's booking, conversation, message, notification or profile — by direct URL or crafted POST (403/404).
- **AC-12 (MUST)** Every state-changing request without a valid CSRF token is rejected.

### Profiles
- **AC-13 (MUST)** A student can create/edit their profile; values persist and re-render.
- **AC-14 (MUST)** A tutor can create/edit a tutor profile, add/remove subjects with levels, and publish/unpublish.
- **AC-15 (MUST)** An unpublished or incomplete tutor never appears in search; the tutor is shown exactly what is missing.
- **AC-16 (MUST)** Profile input is validated (lengths, rate ≥ 0, valid URL for meeting link) and rejected input is reported per field.

### Search
- **AC-17 (MUST)** Any visitor can list published tutors with rating, subjects, mode and rate visible.
- **AC-18 (MUST)** Keyword search matches name, headline, bio and subject.
- **AC-19 (MUST)** Filters (subject, level, mode, min rating, max rate, day of week) work individually and combined, and sorting works.
- **AC-20 (MUST)** No results shows a designed empty state with a way to broaden the search; filter state survives reload and back-navigation.
- **AC-21 (MUST)** Malformed filter values (`?minRating=abc`, `?page=-5`, oversized input) do not error — they are ignored or clamped.

### Availability & booking
- **AC-22 (MUST)** A tutor can add and remove weekly availability blocks and mark time off; invalid ranges (end ≤ start, overlap, out-of-range) are rejected.
- **AC-23 (MUST)** A student sees only genuinely bookable slots (future, outside lead time, not on time off, not already taken).
- **AC-24 (MUST)** A student can request a session for a slot with a subject and note; the booking is `pending` and appears for both parties.
- **AC-25 (MUST)** The tutor can accept or decline; status and both dashboards update; the student is notified.
- **AC-26 (MUST)** Either party can cancel with a reason; the other is notified; the slot is released.
- **AC-27 (MUST)** A slot already held by an active booking cannot be double-booked, including under concurrent requests; the loser sees a clear message.
- **AC-28 (MUST)** Bookings in the past, on nonexistent slots, for subjects the tutor doesn't teach, or by the tutor on themselves are rejected.
- **AC-29 (MUST)** A confirmed session in the past shows as `completed` without manual action.
- **AC-30 (MUST)** Only the tutor can accept/decline; a student POSTing the accept endpoint is refused.

### Messaging, notifications, reviews
- **AC-31 (MUST)** Two users can exchange messages in a thread; only participants can open it.
- **AC-32 (MUST)** Empty/whitespace messages are rejected; over-long messages are rejected with a clear message; message content is escaped on render (no XSS).
- **AC-33 (MUST)** Unread counts are accurate and clear when the thread is read.
- **AC-34 (MUST)** Booking events and new messages create notifications for the right recipient only, with a working deep link.
- **AC-35 (MUST)** A student can review a completed session once; a second attempt is refused.
- **AC-36 (MUST)** Reviews cannot be left on pending/declined/cancelled sessions or by non-participants.
- **AC-37 (MUST)** Tutor rating aggregate matches the visible non-hidden reviews and updates on write.

### Dashboards, history, admin
- **AC-38 (MUST)** Student and tutor dashboards show correct role-specific data and working actions.
- **AC-39 (MUST)** Session history shows all past sessions with correct statuses and filters.
- **AC-40 (MUST)** An admin can list/search users, suspend and reinstate them, and manage subjects; actions are audit-logged.
- **AC-41 (MUST)** An admin can hide a review and the tutor's aggregate rating updates.

### Platform quality
- **AC-42 (MUST)** Every page is usable at 320px, 768px and 1280px with no horizontal overflow, no clipped controls and working navigation.
- **AC-43 (MUST)** Every list has loading/empty/error states; every mutation gives explicit success or failure feedback.
- **AC-44 (MUST)** Every interactive element is keyboard reachable with a visible focus state; forms have real labels; there is one `h1` per page.
- **AC-45 (MUST)** Data persists across server restarts.
- **AC-46 (MUST)** A fresh clone runs with the documented steps and a seeded database, and the repository contains no secrets.
- **AC-47 (MUST)** The automated test suite passes and covers auth, authorisation, booking conflicts, slot generation, validation and review gating.
- **AC-48 (MUST)** No page presents a control that does nothing.
- **AC-49 (SHOULD)** Server errors render a friendly 500 page while the stack goes only to the server log.
- **AC-50 (SHOULD)** Response times for list pages stay under 150ms with seed data.

---

**Hand-off:** specification approved for implementation. Software Engineer to proceed with M1.
