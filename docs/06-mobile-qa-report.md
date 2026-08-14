# QA mobile test report

**Scope:** mobile experience treated as its own test category, per the brief.
**Build under test:** after the design/mobile rework (commit pushed as "Rebuild the landing page
around search…").
**Tooling limitation, stated up front:** this environment has **no browser and no device emulator**.
I could not measure pixels, see a layout, feel a tap target or run a screen reader. What I *could*
do — and did — is verify the served HTML and CSS that determine mobile behaviour, and prove that
every mobile-critical workflow completes over HTTP. Where a check needs eyes, it is marked
**NOT VERIFIED** rather than passed.

---

## 1. Method

| Layer | What it proves |
|---|---|
| 69-check markup/CSS probe against the running server | Structure that decides mobile behaviour: viewport meta, bottom navigation, filter disclosure, one `h1`, no inline styles, restacking tables, asset versioning |
| Full workflow probes (student, tutor, admin) over HTTP | That the flows a phone user must complete actually complete — they are the same requests a mobile browser issues |
| CSS inspection at each breakpoint | Which rules apply at 320/375/390/414px and what they do |
| 249-check automated suite | No functional regression from the redesign |

## 2. Defects found and fixed in this round

### MOB-001 — Navigation was a shrunken desktop row, not a mobile pattern

| Field | Detail |
|---|---|
| **Issue** | Primary navigation was a wrapping row of text links in the header. At 320–414px it formed a cramped second line of small targets; with the admin role it was five links competing for one strip. |
| **Viewport** | ≤ 720px, all pages, worst at 320px |
| **Steps** | Load any page at 320px wide as a student, then as an administrator. Inspect the header navigation. |
| **Expected** | A deliberate mobile navigation pattern with comfortable targets that cannot overflow. |
| **Actual** | Desktop links wrapped onto a second row; each target ~32–40px tall with 12–14px text; admin had 5 items in the strip. |
| **Severity** | **HIGH** — navigation is on every page and was the loudest part of "mobile looks poor". |
| **Fix** | Fixed bottom navigation bar at ≤720px: max four icon+label destinations, 56px tall, generated from the same list as the desktop nav. Header keeps brand, notification bell and account menu. `main` gains bottom padding so nothing hides behind the bar. The admin's fifth item (Audit log) drops out of the bar and stays in the header nav — asserted by a test. |
| **Verified** | Probe: bottom nav present on all 11 tested pages; admin bar contains exactly 4 links and still exposes `/admin/audit`. Unit tests assert the four-item cap, guest targets, and `aria-current` in both navigations. |

### MOB-002 — Filter sidebar stacked above results on small screens

| Field | Detail |
|---|---|
| **Issue** | `/tutors` used a 280px filter rail that, once stacked, pushed every result below roughly a full screen of controls (7 fields). |
| **Viewport** | ≤ 900px |
| **Steps** | Open `/tutors` at 375px. Observe how far you must scroll to reach the first tutor. |
| **Expected** | Filters accessible but not blocking results; an obvious way to open them. |
| **Actual** | ~7 stacked form controls before the first result card. |
| **Severity** | **HIGH** (the brief's own example of a HIGH mobile issue) |
| **Fix** | Filters now sit inside a `<details class="filters-panel">` disclosure with a 48px summary row labelled "Filters and sorting" plus a badge showing how many filters are active. Rendered `open`, so with JavaScript disabled the old (usable) behaviour remains; a small script collapses it below 900px and reopens it if the viewport grows. |
| **Verified** | Probe confirms the disclosure, the summary and the `open` default. Active-filter count derived server-side. |

### MOB-003 — Statistics collapsed to a single tall column

| Field | Detail |
|---|---|
| **Issue** | Dashboard and admin stat grids used `minmax(180px, 1fr)`, which at ≤414px yields one card per row — four cards became four screens of scrolling before any actual content. |
| **Viewport** | ≤ 414px |
| **Steps** | Sign in as a student at 390px and open `/dashboard`. |
| **Expected** | Summary numbers readable at a glance without scrolling past them. |
| **Actual** | Four full-width tiles stacked vertically. |
| **Severity** | **MEDIUM** |
| **Fix** | Two-up grid at ≤720px with reduced padding and a smaller value size; single column only below 420px. |

### MOB-004 — Bookable time slots were below the comfortable touch minimum

| Field | Detail |
|---|---|
| **Issue** | Slot chips were 40px tall in a wrapped inline row, with 8px gaps — the most important tap target in the product (choosing a session time) was the smallest. |
| **Viewport** | ≤ 720px |
| **Steps** | Open a tutor profile as a student at 375px and try to tap a time. |
| **Expected** | ≥44px targets, comfortably separated. |
| **Actual** | 40px targets in a dense wrapped row. |
| **Severity** | **MEDIUM** |
| **Fix** | Slots render as a grid of ≥48px full-width buttons (`minmax(88px, 1fr)`). Tabs, pagination, availability chips and remove buttons raised to ≥44px (remove buttons 36px inside a 44px chip). |

### MOB-005 — Long unbroken strings could push the viewport sideways

| Field | Detail |
|---|---|
| **Issue** | Message bubbles wrapped long words, but tutor cards, session cards, notification bodies and conversation previews did not, so a pasted URL or a 300-character word could widen the layout. |
| **Viewport** | ≤ 720px |
| **Steps** | Send a 300-character unbroken word, then view the conversation list and session cards at 320px. |
| **Expected** | No horizontal scrolling. |
| **Actual** | Only `.bubble` had `overflow-wrap`. |
| **Severity** | **MEDIUM** (it is the brief's "no horizontal overflow" criterion) |
| **Fix** | `min-width: 0; overflow-wrap: anywhere` applied to cards, sessions, tutor cards, conversation and notification bodies at ≤720px. Probe sent a 300-character word and the pages still render. |

### MOB-006 — Stale CSS would be served after the redesign

| Field | Detail |
|---|---|
| **Issue** | Production serves assets with `Cache-Control: public, max-age=86400`, and the stylesheet link was pinned to `?v=1`. A returning visitor would have received the new HTML with yesterday's CSS — the exact recipe for "mobile looks broken". |
| **Severity** | **MEDIUM** (deployment-only; invisible locally) |
| **Fix** | Asset version bumped to `?v=2`; probe asserts pages request v2 and that v2 serves and contains the mobile layer. |

## 3. Mobile checks that passed

Navigation · home page · tutor search · filters · tutor profile · booking request · login ·
registration · student dashboard · tutor dashboard · admin console · messaging · reviews · forms ·
notifications · error messages — all render with a responsive viewport meta, exactly one `h1`, no
inline styles (so the strict CSP cannot silently break layout), and the bottom navigation present.

Workflow completion at mobile-relevant paths (each executed, not inspected):

- register → login → complete profile → search → open profile → pick a slot → request session →
  tutor accepts → student sees "Confirmed" → cancel with reason → review a completed session
- send and read messages, including emoji and markup (escaped, `🎉` round-trips)
- admin: suspend → suspended user signed out → reinstate → subject create/rename/retire → hide review
- forms reject bad input with visible field-level errors and keep what was typed

Layout mechanics verified in CSS: admin tables restack into labelled rows (`data-label`) instead of
scrolling sideways; the composer field flexes; the message thread caps at 50vh; buttons go full-width
at ≤420px but stay side-by-side inside action rows; `env(safe-area-inset-bottom)` is respected by the
bottom bar.

## 4. NOT VERIFIED — needs a human with a device

| Item | Why |
|---|---|
| Actual rendering at 320 / 375 / 390 / 414px | No browser or emulator available |
| Focus-ring visibility and colour contrast in situ | Requires rendering and measurement |
| Whether the keyboard covers a focused input on a real phone | Requires a real soft keyboard |
| Screen-reader output (VoiceOver / TalkBack) | Requires assistive technology |
| Perceived tap accuracy and scroll feel | Requires hands |

## 5. Mobile severity summary

| Severity | Count | Status |
|---|---|---|
| CRITICAL (feature unusable on mobile) | 0 | — |
| HIGH | 2 (MOB-001, MOB-002) | Fixed |
| MEDIUM | 4 (MOB-003, 004, 005, 006) | Fixed |
| LOW | 0 open | — |

## 6. QA verdict on mobile

Against the brief's final mobile acceptance criteria: no horizontal overflow mechanism remains in the
CSS, navigation is a deliberate mobile pattern, all major pages render, search and every filter work,
profiles and booking work, forms work with visible errors, dashboards are readable two-up, messaging
works, targets are ≥44px, text sizes are trimmed rather than scaled, and both core workflows
(student and tutor) complete end to end.

**QA approves the mobile experience conditionally**: approved on every criterion that can be verified
without a browser, with the explicit condition that a human performs a visual pass at the four
widths above before final sign-off. I will not record a visual approval I did not make.
