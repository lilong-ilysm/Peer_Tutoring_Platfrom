/**
 * View-layer guarantees: the error page, accessibility-affecting markup and the
 * components that carry status meaning (AC-43, AC-44, AC-48, AC-49).
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  alert,
  emptyState,
  errorSummary,
  money,
  selectField,
  stars,
  statusBadge,
  tabs,
  textField,
  timeTag,
} from '../src/web/views/components.js';
import { layout } from '../src/web/views/layout.js';
import { errorPage } from '../src/web/views/pages/error.js';
import { landingPage } from '../src/web/views/pages/landing.js';

const render = (fragment) => fragment.value ?? String(fragment);

describe('error page', () => {
  test('shows the status, an explanation and a way out', () => {
    const html = render(errorPage({ status: 404 }));
    assert.match(html, /404/);
    assert.match(html, /Page not found/);
    assert.match(html, /href="\/"/);
  });

  test('uses the exposed message when one is given', () => {
    const html = render(errorPage({ status: 403, message: 'That area is for tutor accounts.' }));
    assert.match(html, /That area is for tutor accounts/);
  });

  test('escapes the message and never leaks markup', () => {
    const html = render(errorPage({ status: 400, message: '<script>alert(1)</script>' }));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  test('sends a signed-in user back to their own home', () => {
    const student = render(errorPage({ status: 404, user: { role: 'student' } }));
    assert.match(student, /href="\/dashboard"/);
    const admin = render(errorPage({ status: 404, user: { role: 'admin' } }));
    assert.match(admin, /href="\/admin"/);
  });

  test('an unknown status still renders a sensible page', () => {
    const html = render(errorPage({ status: 418 }));
    assert.match(html, /418/);
    assert.match(html, /went wrong/);
  });
});

describe('filter tabs (PM-4)', () => {
  const markup = render(
    tabs(
      [
        { label: 'Upcoming', href: '/bookings?scope=upcoming', active: true, count: 2 },
        { label: 'Past', href: '/bookings?scope=past', active: false },
      ],
      { label: 'Filter sessions' }
    )
  );

  test('is navigation, not a fake ARIA tablist', () => {
    assert.ok(!markup.includes('role="tab"'));
    assert.ok(!markup.includes('role="tablist"'));
    assert.match(markup, /<nav class="tabs" aria-label="Filter sessions">/);
  });

  test('marks the current filter with aria-current', () => {
    assert.match(markup, /aria-current="page"/);
    assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  });
});

describe('rating component (PM-3)', () => {
  test('an aggregate shows the count', () => {
    const html = render(stars(4.5, 12));
    assert.match(html, /4\.5/);
    assert.match(html, /12 reviews/);
    assert.match(html, /Rated 4\.5 out of 5 from 12 reviews/);
  });

  test('a single review shows no review count', () => {
    const html = render(stars(5, 1, { compact: true }));
    assert.match(html, /5\.0/);
    assert.ok(!html.includes('review)'));
    assert.match(html, /Rated 5\.0 out of 5/);
  });

  test('an unrated tutor says so instead of showing zero stars as a score', () => {
    const html = render(stars(0, 0));
    assert.match(html, /No reviews yet/);
  });
});

describe('status and money', () => {
  test('every booking status renders a text label, not colour alone', () => {
    for (const [status, label] of [
      ['pending', 'Pending'],
      ['confirmed', 'Confirmed'],
      ['declined', 'Declined'],
      ['cancelled', 'Cancelled'],
      ['completed', 'Completed'],
    ]) {
      assert.match(render(statusBadge(status)), new RegExp(label));
    }
  });

  test('a free tutor is described as free rather than as zero', () => {
    assert.match(render(money(0)), /Free/);
    assert.match(render(money(12500)), /125\.00/);
  });

  test('times are machine readable', () => {
    const html = render(timeTag('2026-08-17T09:00:00.000Z'));
    assert.match(html, /<time\s[^>]*datetime="2026-08-17T09:00:00\.000Z"/);
    assert.match(html, /17 Aug 2026/, 'and human readable in the platform timezone');
  });
});

describe('form fields', () => {
  test('a field renders a label bound to its input', () => {
    const html = render(textField({ name: 'email', label: 'Email address', value: 'a@b.test' }));
    assert.match(html, /<label class="field__label" for="email">/);
    assert.match(html, /id="email"/);
    assert.match(html, /value="a@b.test"/);
  });

  test('an invalid field is announced to assistive technology', () => {
    const html = render(
      textField({ name: 'email', label: 'Email address', error: 'Enter a valid email address.' })
    );
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-describedby="email-error"/);
    assert.match(html, /id="email-error"/);
  });

  test('field values and errors are escaped', () => {
    const html = render(
      textField({ name: 'q', label: 'Search', value: '"><script>alert(1)</script>', error: '<b>bad</b>' })
    );
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<b>bad</b>'));
  });

  test('a select marks the current option and offers a placeholder', () => {
    const html = render(
      selectField({
        name: 'mode',
        label: 'Mode',
        value: 'online',
        placeholder: 'Any mode',
        options: [
          { value: 'online', label: 'Online' },
          { value: 'in_person', label: 'In person' },
        ],
      })
    );
    assert.match(html, /<option value="">Any mode<\/option>/);
    assert.match(html, /value="online"\s*selected/);
  });

  test('the error summary links to each field', () => {
    const html = render(errorSummary({ email: 'Enter a valid email address.', password: 'Too short.' }));
    assert.match(html, /href="#email"/);
    assert.match(html, /href="#password"/);
    assert.match(html, /role="alert"/);
  });

  test('empty states explain themselves and offer an action', () => {
    const html = render(
      emptyState({
        title: 'No sessions yet',
        message: 'Find a tutor to get started.',
        actionLabel: 'Find a tutor',
        actionHref: '/tutors',
      })
    );
    assert.match(html, /No sessions yet/);
    assert.match(html, /href="\/tutors"/);
  });

  test('flash messages carry a role so they are announced', () => {
    assert.match(render(alert({ type: 'error', message: 'Something failed.' })), /role="alert"/);
    assert.match(render(alert({ type: 'success', message: 'Saved.' })), /role="status"/);
    assert.equal(render(alert(null)), '');
  });
});

describe('page shell', () => {
  function shell(user, extra = {}) {
    return render(
      layout({
        title: 'Test page',
        body: '<p>content</p>',
        user,
        csrfToken: 'token-123',
        ...extra,
      })
    );
  }

  test('includes the accessibility scaffolding', () => {
    const html = shell(null);
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main class="main" id="main">/);
    assert.match(html, /aria-label="Main navigation"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /<html lang="en">/);
  });

  test('never emits an inline style or inline script (CSP has no unsafe-inline)', () => {
    const html = shell({ id: 1, full_name: 'Test User', role: 'student', email: 'a@b.test' });
    assert.ok(!html.includes('style="'));
    assert.ok(!/<script(?![^>]*src=)/.test(html));
  });

  test('shows role-appropriate navigation', () => {
    const guest = shell(null);
    assert.match(guest, /href="\/login"/);
    assert.match(guest, /href="\/register"/);

    const student = shell({ id: 1, full_name: 'Sam Student', role: 'student', email: 's@test.local' });
    assert.match(student, /href="\/tutors"/);
    assert.match(student, /href="\/bookings"/);
    assert.ok(!student.includes('href="/admin"'));

    const tutor = shell({ id: 2, full_name: 'Tara Tutor', role: 'tutor', email: 't@test.local' });
    assert.match(tutor, /href="\/profile\/availability"/);

    const admin = shell({ id: 3, full_name: 'Ada Admin', role: 'admin', email: 'a@test.local' });
    assert.match(admin, /href="\/admin\/users"/);
    assert.ok(!admin.includes('href="/bookings"'));
  });

  test('the notification bell announces the unread count (PM-5)', () => {
    const withUnread = shell(
      { id: 1, full_name: 'Sam Student', role: 'student', email: 's@test.local' },
      { unreadNotifications: 3 }
    );
    assert.match(withUnread, /aria-label="Notifications: 3 unread"/);

    const withNone = shell({ id: 1, full_name: 'Sam Student', role: 'student', email: 's@test.local' });
    assert.match(withNone, /aria-label="Notifications: none unread"/);
    assert.match(withNone, /icon-button__badge is-hidden/);
  });

  test('the logout control is a POST form carrying the CSRF token', () => {
    const html = shell({ id: 1, full_name: 'Sam Student', role: 'student', email: 's@test.local' });
    assert.match(html, /<form class="menu__form" method="post" action="\/logout">/);
    assert.match(html, /name="_csrf" value="token-123"/);
  });

  test('a hostile display name cannot inject markup', () => {
    const html = shell({
      id: 1,
      full_name: '<img src=x onerror=alert(1)> Hacker',
      role: 'student',
      email: 'h@test.local',
    });
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img src=x/);
  });
});

describe('landing page is a tool, not a brochure (design review)', () => {
  const sample = {
    stats: { tutors: 6, subjectsCovered: 13, completedSessions: 7 },
    featured: [
      {
        id: 2,
        full_name: 'Naledi Mokoena',
        headline: 'Third-year maths student',
        bio: 'I work through past papers and stop at the step that breaks.',
        mode: 'both',
        hourly_rate_cents: 12000,
        rating_avg: 5,
        rating_count: 2,
        subjects: [{ subject_id: 1, name: 'Calculus I', code: 'MAT101', level: 'advanced' }],
      },
    ],
    subjects: [
      { id: 1, name: 'Calculus I', tutor_count: 2 },
      { id: 2, name: 'Linear Algebra', tutor_count: 1 },
      { id: 3, name: 'Latin', tutor_count: 0 },
    ],
  };

  const html = render(landingPage(sample));

  test('the first interactive element is a working search that submits to /tutors', () => {
    assert.match(html, /<form class="home-search" method="get" action="\/tutors" role="search">/);
    assert.match(html, /name="q"/);
    assert.match(html, /name="subject"/);
    assert.match(html, /Search tutors/);
  });

  test('platform numbers come from the passed data, never hardcoded', () => {
    assert.match(html, /<strong>6<\/strong> tutors taking bookings/);
    assert.match(html, /<strong>13<\/strong> subjects with a tutor/);
    assert.match(html, /<strong>7<\/strong> sessions completed/);
  });

  test('only subjects that actually have a tutor are offered', () => {
    assert.match(html, /Calculus I/);
    assert.ok(!html.includes('Latin'), 'a subject with no tutor is not advertised');
  });

  test('tutor descriptions are rendered, not replaced by a placeholder', () => {
    assert.match(html, /stop at the step that breaks/);
    assert.ok(!html.includes('No description added yet'));
  });

  test('what a displayed rate means is stated on the page', () => {
    assert.match(html, /does not process payments/);
    assert.match(html, /arrange any payment directly/);
  });

  test('the marketing surface is restrained: one h1, no repeated CTA block', () => {
    assert.equal((html.match(/<h1/g) || []).length, 1);
    assert.ok(!html.includes('Ready to start?'));
    assert.ok(!html.includes('hero__eyebrow'));
    // "Find a tutor"/"Get started" style buttons should not be repeated.
    assert.ok((html.match(/class="btn btn--primary"/g) || []).length <= 1);
  });
});

describe('mobile navigation', () => {
  function shellFor(user) {
    return render(layout({ title: 'T', body: '<p>x</p>', user, csrfToken: 't' }));
  }

  test('a bottom bar is rendered with at most four labelled targets', () => {
    const html = shellFor({ id: 1, full_name: 'Sam Student', role: 'student', email: 's@t.local' });
    assert.match(html, /<nav class="bottom-nav" aria-label="Primary">/);
    const links = html.match(/class="bottom-nav__link[^"]*"/g) || [];
    assert.ok(links.length > 0 && links.length <= 4, `expected 1-4 targets, got ${links.length}`);
    assert.match(html, /bottom-nav__label">Dashboard/);
    assert.match(html, /bottom-nav__label">Messages/);
  });

  test('guests get sign-in targets rather than a dead bar', () => {
    const html = shellFor(null);
    assert.match(html, /bottom-nav__label">Log in/);
    assert.match(html, /bottom-nav__label">Sign up/);
  });

  test('the admin bar drops the fifth item instead of overflowing', () => {
    const html = shellFor({ id: 3, full_name: 'Ada Admin', role: 'admin', email: 'a@t.local' });
    const links = html.match(/class="bottom-nav__link[^"]*"/g) || [];
    assert.equal(links.length, 4);
    assert.ok(!/bottom-nav__label">Audit log/.test(html), 'audit log stays in the header nav');
    assert.match(html, /href="\/admin\/audit"/, 'but is still reachable');
  });

  test('both navigations are generated from one list, so they cannot drift', () => {
    const html = shellFor({ id: 2, full_name: 'Tara Tutor', role: 'tutor', email: 't@t.local' });
    for (const href of ['/dashboard', '/bookings', '/profile/availability', '/messages']) {
      const occurrences = (html.match(new RegExp(`href="${href.replace(/\//g, '\\/')}"`, 'g')) || []).length;
      assert.ok(occurrences >= 2, `${href} should appear in the header and the bottom bar`);
    }
  });

  test('the current page is marked in both navigations', () => {
    const html = render(
      layout({
        title: 'T',
        body: '<p>x</p>',
        user: { id: 1, full_name: 'Sam Student', role: 'student', email: 's@t.local' },
        activeNav: 'bookings',
        csrfToken: 't',
      })
    );
    assert.ok((html.match(/aria-current="page"/g) || []).length >= 2);
  });
});
