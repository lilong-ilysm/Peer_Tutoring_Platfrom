/**
 * Tutor search: every filter individually, filters combined, sorting,
 * pagination, visibility rules and literal handling of LIKE metacharacters.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { addBlock } from '../src/services/availability.js';
import { createSubject } from '../src/services/subjects.js';
import {
  addTutorSubject,
  saveTutorProfile,
  searchTutors,
  setPublished,
} from '../src/services/tutors.js';
import { setUserStatus } from '../src/services/users.js';
import { tutorSearchPage } from '../src/web/views/pages/tutors.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, makeTutor } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

let maths;
let physics;
let alice; // online, cheap, maths intro, Mondays only
let brian; // in person, mid, physics advanced, every day
let cara; // both, expensive, maths advanced + physics intro, every day

before(() => {
  maths = createSubject({ code: 'MTH100', name: 'Calculus Basics', category: 'Mathematics' });
  physics = createSubject({ code: 'PHY100', name: 'Classical Mechanics', category: 'Physics' });

  alice = makeTutor({
    name: 'Alice Online',
    mode: 'online',
    rateCents: 5000,
    subject: maths,
    level: 'intro',
    blocks: [[1, 9 * 60, 17 * 60]],
  });

  brian = makeTutor({
    name: 'Brian Campus',
    mode: 'in_person',
    rateCents: 12000,
    subject: physics,
    level: 'advanced',
  });

  cara = makeTutor({
    name: 'Cara Hybrid',
    mode: 'both',
    rateCents: 25000,
    subject: maths,
    level: 'advanced',
  });
  addTutorSubject(cara.user.id, physics.id, 'intro');
  saveTutorProfile(cara.user.id, {
    headline: 'Cara Hybrid tutors calculus and mechanics for first years',
    bio: 'I specialise in exam technique and past papers.',
    mode: 'both',
    campus: 'Library room 3',
    meetingLink: 'https://meet.example.edu/cara',
    hourlyRateCents: 25000,
    yearsExperience: 3,
  });
});

function names(result) {
  return result.rows.map((row) => row.full_name).sort();
}

describe('visibility', () => {
  test('lists every published, complete tutor', () => {
    assert.deepEqual(names(searchTutors({})), ['Alice Online', 'Brian Campus', 'Cara Hybrid']);
  });

  test('excludes an unpublished tutor', () => {
    setPublished(brian.user.id, false);
    assert.deepEqual(names(searchTutors({})), ['Alice Online', 'Cara Hybrid']);
    setPublished(brian.user.id, true);
  });

  test('excludes a suspended tutor', () => {
    setUserStatus(brian.user.id, 'suspended');
    assert.equal(names(searchTutors({})).includes('Brian Campus'), false);
    setUserStatus(brian.user.id, 'active');
  });

  test('excludes a tutor with no availability', () => {
    const incomplete = makeTutor({ name: 'Dora NoTime', blocks: [], publish: false });
    assert.equal(names(searchTutors({})).includes('Dora NoTime'), false);
    // Even if published is forced on directly, the visibility rule still hides them.
    ctx.database.run('UPDATE tutor_profiles SET is_published = 1 WHERE user_id = ?', [
      incomplete.user.id,
    ]);
    assert.equal(names(searchTutors({})).includes('Dora NoTime'), false);
  });

  test('never lists students', () => {
    makeStudent({ name: 'Sneaky Student' });
    assert.equal(names(searchTutors({})).includes('Sneaky Student'), false);
  });
});

describe('individual filters', () => {
  test('keyword matches the name', () => {
    assert.deepEqual(names(searchTutors({ q: 'Alice' })), ['Alice Online']);
  });

  test('keyword matches the headline and bio', () => {
    assert.deepEqual(names(searchTutors({ q: 'exam technique' })), ['Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ q: 'first years' })), ['Cara Hybrid']);
  });

  test('keyword matches a subject name and code', () => {
    assert.deepEqual(names(searchTutors({ q: 'Classical' })), ['Brian Campus', 'Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ q: 'MTH100' })), ['Alice Online', 'Cara Hybrid']);
  });

  test('keyword search is case insensitive and trims to no match cleanly', () => {
    assert.deepEqual(names(searchTutors({ q: 'aLiCe' })), ['Alice Online']);
    assert.equal(searchTutors({ q: 'zzzzz-nothing' }).total, 0);
  });

  test('wildcard characters are treated literally (PM-2)', () => {
    // Before the fix these returned every tutor.
    assert.equal(searchTutors({ q: '%' }).total, 0);
    assert.equal(searchTutors({ q: '_' }).total, 0);
    assert.equal(searchTutors({ q: 'A%e' }).total, 0);
    assert.equal(searchTutors({ q: '\\' }).total, 0);
  });

  test('subject filter', () => {
    assert.deepEqual(names(searchTutors({ subjectId: maths.id })), ['Alice Online', 'Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ subjectId: physics.id })), ['Brian Campus', 'Cara Hybrid']);
  });

  test('level filter, alone and with a subject', () => {
    assert.deepEqual(names(searchTutors({ level: 'intro' })), ['Alice Online', 'Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ subjectId: maths.id, level: 'advanced' })), ['Cara Hybrid']);
    assert.equal(searchTutors({ subjectId: physics.id, level: 'intermediate' }).total, 0);
  });

  test('mode filter includes tutors who offer both', () => {
    assert.deepEqual(names(searchTutors({ mode: 'online' })), ['Alice Online', 'Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ mode: 'in_person' })), ['Brian Campus', 'Cara Hybrid']);
  });

  test('max rate filter', () => {
    assert.deepEqual(names(searchTutors({ maxRateCents: 5000 })), ['Alice Online']);
    assert.deepEqual(names(searchTutors({ maxRateCents: 12000 })), ['Alice Online', 'Brian Campus']);
    assert.equal(searchTutors({ maxRateCents: 100 }).total, 0);
  });

  test('day-of-week filter', () => {
    // Alice is only available on Mondays (weekday 1).
    assert.deepEqual(names(searchTutors({ weekday: 1 })), ['Alice Online', 'Brian Campus', 'Cara Hybrid']);
    assert.deepEqual(names(searchTutors({ weekday: 3 })), ['Brian Campus', 'Cara Hybrid']);
    addBlock(alice.user.id, { weekday: 3, startMinute: 10 * 60, endMinute: 12 * 60 });
    assert.deepEqual(names(searchTutors({ weekday: 3 })), ['Alice Online', 'Brian Campus', 'Cara Hybrid']);
  });

  test('minimum rating filter excludes unrated tutors', () => {
    assert.equal(searchTutors({ minRating: 1 }).total, 0, 'nobody has been reviewed yet');
    assert.equal(searchTutors({ minRating: 0 }).total, 3);
  });
});

describe('combined filters, sorting and pagination', () => {
  test('filters combine as AND', () => {
    assert.deepEqual(
      names(searchTutors({ subjectId: maths.id, mode: 'online', maxRateCents: 6000 })),
      ['Alice Online']
    );
    assert.equal(
      searchTutors({ subjectId: physics.id, mode: 'online', maxRateCents: 6000 }).total,
      0,
      'no cheap online physics tutor exists'
    );
    assert.deepEqual(
      names(searchTutors({ q: 'Cara', subjectId: physics.id, level: 'intro', weekday: 5 })),
      ['Cara Hybrid']
    );
  });

  test('sorting by rate ascending and descending', () => {
    const ascending = searchTutors({ sort: 'rate_asc' }).rows.map((row) => row.hourly_rate_cents);
    assert.deepEqual(ascending, [...ascending].sort((a, b) => a - b));
    const descending = searchTutors({ sort: 'rate_desc' }).rows.map((row) => row.hourly_rate_cents);
    assert.deepEqual(descending, [...descending].sort((a, b) => b - a));
  });

  test('sorting by name', () => {
    assert.deepEqual(
      searchTutors({ sort: 'name' }).rows.map((row) => row.full_name),
      ['Alice Online', 'Brian Campus', 'Cara Hybrid']
    );
  });

  test('an unknown sort falls back to the default instead of failing', () => {
    assert.equal(searchTutors({ sort: 'drop table' }).total, 3);
  });

  test('pagination clamps and reports totals', () => {
    const firstPage = searchTutors({ pageSize: 2, page: 1, sort: 'name' });
    assert.equal(firstPage.rows.length, 2);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.total, 3);

    const secondPage = searchTutors({ pageSize: 2, page: 2, sort: 'name' });
    assert.equal(secondPage.rows.length, 1);
    assert.equal(secondPage.page, 2);

    const beyondEnd = searchTutors({ pageSize: 2, page: 99, sort: 'name' });
    assert.equal(beyondEnd.page, 2, 'page is clamped to the last page');
  });

  test('results carry the subjects needed by the card, with no extra query per row', () => {
    for (const row of searchTutors({}).rows) {
      assert.ok(Array.isArray(row.subjects));
      assert.ok(row.subjects.length > 0);
      assert.ok(row.subjects[0].name);
      assert.ok(row.subjects[0].level);
    }
  });
});

describe('search page rendering', () => {
  const emptyFilters = {
    q: '',
    subjectId: null,
    level: null,
    mode: null,
    minRating: null,
    maxRate: null,
    weekday: null,
    sort: 'rating',
    page: 1,
  };

  test('renders a designed empty state with a way out when filters match nothing', () => {
    const html = tutorSearchPage({
      filters: { ...emptyFilters, q: 'nothing-matches' },
      results: { rows: [], total: 0, page: 1, totalPages: 1, pageSize: 9 },
      subjects: [],
      query: { q: 'nothing-matches' },
    }).value;

    assert.match(html, /No tutors match those filters/);
    assert.match(html, /Clear filters/);
    assert.match(html, /href="\/tutors"/);
  });

  test('keeps the typed keyword and selected sort in the form', () => {
    const html = tutorSearchPage({
      filters: { ...emptyFilters, q: 'calculus', sort: 'rate_asc' },
      results: { rows: [], total: 0, page: 1, totalPages: 1, pageSize: 9 },
      subjects: [{ id: 1, name: 'Calculus Basics', tutor_count: 2 }],
      query: { q: 'calculus', sort: 'rate_asc' },
    }).value;

    assert.match(html, /value="calculus"/);
    assert.match(html, /value="rate_asc"\s*selected/);
  });

  test('escapes a hostile keyword when echoing it back', () => {
    const html = tutorSearchPage({
      filters: { ...emptyFilters, q: '<img src=x onerror=alert(1)>' },
      results: { rows: [], total: 0, page: 1, totalPages: 1, pageSize: 9 },
      subjects: [],
      query: {},
    }).value;

    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img src=x/);
  });
});
