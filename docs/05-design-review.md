# Project Manager design review — "product or advertisement?"

Reviewing the interface against the feedback that the site *feels like an advertisement* and that
*mobile looks poor*. I treated both as hypotheses and checked the actual pages.

---

## 1. The verdict

**On the home page: the feedback was right.** Everything behind the login was already task-oriented,
but the front door was selling the product instead of being the product.

What created that impression, specifically:

| Element (before) | Why it read as advertising |
|---|---|
| Full-width two-column hero occupying the first screen | The first thing a visitor could *do* was scroll |
| "Campus peer tutoring" pill badge above the heading | Pure decoration; carried no information |
| 30px marketing headline + a 3-line lead paragraph | Slogan, not orientation |
| Three large stat tiles in a raised, shadowed panel | Numbers presented as achievements ("On the platform right now") rather than as facts to act on |
| Two CTAs in the hero, then two more in a closing "Ready to start?" card | Four calls to action on one page, none of which *did* anything except navigate |
| Two side-by-side 4-step "How it works" columns (8 cards) | A brochure spread; ~40% of the page height |
| A row of reassurance badges ("No payments on platform", "Peer reviewed", "You control your data") | Trust-marketing garnish |
| **No search input anywhere on the home page** | The platform's core action was two clicks away behind a button |

The last row is the real indictment: a tutoring platform whose home page cannot search for a tutor is
a landing page for a tutoring platform, not a tutoring platform.

**On mobile: partly right, and my earlier decision was wrong.** I had chosen a wrapping navigation
row instead of a mobile pattern, on the grounds that it needed no JavaScript. On a 320px screen that
produces a cramped two-line strip of small text links — technically not overflowing, but nobody would
call it designed. Statistics also collapsed to a single tall column, so a dashboard became a long
scroll of one-number cards.

## 2. What changed

Home page, restructured to **navigation → one-line value proposition → working search → live data →
how it works**:

- Removed: the hero grid, the eyebrow badge, the stat panel, the closing CTA card, the badge row, and
  one of the two step columns. Four calls to action became one.
- Added: a real `<form method="get" action="/tutors">` with a keyword field and a subject select, so
  the first interactive element on the site performs the platform's primary task.
- Platform numbers are now one line of plain text ("**6** tutors taking bookings · **13** subjects
  with a tutor · **7** sessions completed") instead of three decorative tiles.
- Subject chips link straight into a filtered search; the list states "Showing 12 of 13" when capped.
- "How it works" is four compact steps in one row; the tutor path is a single sentence with a link.
- Rendered home page markup dropped from ~26KB to ~19KB with *more* function on it.

Mobile, redesigned rather than shrunk:

- **Bottom navigation bar** (≤720px): up to four thumb-reachable icon+label destinations, driven from
  the same list as the desktop header nav so they cannot drift apart. The header keeps identity,
  notifications and the account menu. No JavaScript, no hamburger to discover, no overflow possible.
- **Filters collapse** behind a labelled disclosure showing the active-filter count, instead of a
  desktop sidebar stacked above results. Rendered `open` so it still works with scripting disabled;
  a small script closes it on narrow screens and reopens it if the viewport grows.
- Statistics go **two-up** at ≤720px and one-up at ≤420px, rather than a single tall column.
- Bookable times render as a **tap-target grid** (48px) rather than a wrapped row of 40px chips.
- Touch targets raised to ≥44px on tabs, pagination, availability chips and remove buttons.
- Long words, codes and links wrap (`overflow-wrap: anywhere`) so nothing can push the viewport
  sideways; typography trims at 420px instead of scaling everything down.
- Breakpoints kept to three that the layout actually needs: **900px** (filters/columns), **720px**
  (navigation and density), **420px** (typography and full-width buttons).

## 3. What I deliberately did *not* remove

Not every marketing element is waste, and the brief asked me to judge rather than delete:

- **The one-sentence value proposition stays.** A first-time visitor needs to know what this is.
- **The "How it works" steps stay** (condensed). Booking a peer's time involves a real question —
  "does the tutor have to accept?" — and answering it up front prevents a support message later.
- **"Tutors available now" stays.** It is live data that proves supply and is the fastest route to a
  profile. It is a product surface, not a testimonial.
- **The header "Sign up" button stays.** One persistent call to action in the chrome is
  reasonable; four on the page was not.
- **No animations were added or removed** — there were none beyond 120ms button colour transitions,
  and `prefers-reduced-motion` already disables those.

## 4. Element-by-element decisions

| Feedback category | Found? | Decision |
|---|---|---|
| Promotional slogans | Yes (hero headline + lead) | Reduced to one factual sentence |
| Large marketing statements | Yes ("On the platform right now") | Removed; numbers moved inline |
| Repeated calls-to-action | Yes (4) | Reduced to 1 in content + 1 in header |
| Excessive hero sections | Yes | Removed entirely |
| Oversized headings | Yes (--text-3xl) | h1 now --text-2xl, 1.5rem on mobile, 1.375rem at 420px |
| Promotional statistics | Partly — the numbers are useful, the presentation was not | Kept as data, restyled as text |
| Large decorative sections | Yes (hero panel, CTA card, 8 step cards) | Removed / condensed to 4 |
| Excessive animations | No | Nothing to change |
| Marketing testimonials | No | n/a — reviews shown are real, and only from completed sessions |
| Too many cards / shadows / gradients | Partly | Removed two shadowed panels; no gradients exist |
| Competing buttons | Yes | One primary action per view enforced |

## 5. Data honesty issues found while reviewing

Reviewing the home page for *presentation* turned up two **correctness** problems, which matter more
than the styling:

1. The home page said **"No description added yet"** for tutors who had descriptions, because the
   landing query omitted `bio` while the search query included it. Fixed by giving both one shared
   projection (`CARD_COLUMNS`), with a regression test that renders real cards.
2. **"Subjects covered: 15"** counted the whole catalogue while only 13 subjects had a bookable
   tutor and only 12 chips were shown. Fixed with a derived `subjectsCovered` statistic and an
   explicit "Showing 12 of 13" label.

Both are in [`03-qa-report.md`](03-qa-report.md) as defects with evidence, and in
[`02-pm-review.md`](02-pm-review.md) round 4.

## 6. Verdict after the changes

The home page now reads as the entrance to a tool: heading, sentence, search box, live data. Once
signed in, the interface was already task-first and remains so.

**Approved on the design axis**, with one honest caveat repeated from earlier rounds: no human has
seen these pages rendered in a browser in this environment. Everything above was verified in markup
and CSS, and by 69 automated checks over the served HTML. A visual pass on a real device is still
required before anyone calls the look "signed off".
