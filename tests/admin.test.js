/**
 * Administration: user moderation, subject catalogue, review moderation,
 * statistics and the audit trail (AC-40, AC-41).
 */
import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import { DomainError } from '../src/lib/errors.js';
import { listAudit, platformStats, recentBookings, recordAudit } from '../src/services/admin.js';
import { createSession, login, resolveSession, revokeSessionsOnSuspension } from '../src/services/auth.js';
import { createReview, listReviewsForTutor, setReviewHidden } from '../src/services/reviews.js';
import {
  createSubject,
  getSubject,
  listSubjects,
  setSubjectActive,
  subjectsWithTutorCounts,
  updateSubject,
} from '../src/services/subjects.js';
import { getTutorProfile, setPublished } from '../src/services/tutors.js';
import { listUsers, setUserStatus } from '../src/services/users.js';
import { nowIso } from '../src/lib/time.js';
import { useTempDatabase } from './helpers/database.js';
import { makeAdmin, makeStudent, makeTutor, PASSWORD } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

describe('user moderation', () => {
  test('suspending blocks sign-in and kills live sessions', () => {
    const student = makeStudent({ email: 'moderate-me@test.local', name: 'Moderate Me' });
    const session = createSession(student.id);
    assert.ok(resolveSession(session.token));

    const suspended = setUserStatus(student.id, 'suspended');
    revokeSessionsOnSuspension(student.id);

    assert.equal(suspended.status, 'suspended');
    assert.equal(resolveSession(session.token), null);
    assert.throws(
      () => login({ email: 'moderate-me@test.local', password: PASSWORD }),
      (error) => error instanceof DomainError && /suspended/i.test(error.message)
    );
  });

  test('reinstating restores access', () => {
    const student = makeStudent({ email: 'reinstate-me@test.local' });
    setUserStatus(student.id, 'suspended');
    setUserStatus(student.id, 'active');
    assert.ok(login({ email: 'reinstate-me@test.local', password: PASSWORD }).token);
  });

  test('administrators cannot be suspended', () => {
    const admin = makeAdmin();
    assert.throws(
      () => setUserStatus(admin.id, 'suspended'),
      (error) => error instanceof DomainError && error.status === 403
    );
  });

  test('an unknown status or unknown user is refused', () => {
    const student = makeStudent();
    assert.throws(() => setUserStatus(student.id, 'deleted'), DomainError);
    assert.throws(() => setUserStatus(999999, 'suspended'), DomainError);
  });

  test('the user directory searches, filters and paginates', () => {
    makeStudent({ name: 'Unique Searchname', email: 'unique-search@test.local' });
    makeTutor({ name: 'Findable Tutor', email: 'findable-tutor@test.local' });

    assert.equal(listUsers({ search: 'Unique Searchname' }).total, 1);
    assert.equal(listUsers({ search: 'unique-search@test.local' }).total, 1);
    assert.equal(listUsers({ search: 'nobody-here' }).total, 0);
    assert.ok(listUsers({ role: 'tutor' }).rows.every((row) => row.role === 'tutor'));
    assert.ok(listUsers({ status: 'suspended' }).rows.every((row) => row.status === 'suspended'));

    const page = listUsers({ pageSize: 2, page: 1 });
    assert.equal(page.rows.length, 2);
    assert.ok(page.totalPages >= 2);
    assert.equal(listUsers({ pageSize: 2, page: 999 }).page, page.totalPages, 'page is clamped');
  });

  test('directory search treats wildcards literally', () => {
    assert.equal(listUsers({ search: '%' }).total, 0);
    assert.equal(listUsers({ search: '_' }).total, 0);
  });

  test('the directory never exposes password hashes', () => {
    for (const row of listUsers({}).rows) {
      assert.equal(row.password_hash, undefined);
    }
  });
});

describe('subject catalogue', () => {
  test('subjects are created, renamed and retired', () => {
    const subject = createSubject({ code: 'adm101', name: 'Admin Test Subject', category: 'Testing' });
    assert.equal(subject.code, 'ADM101', 'codes are normalised to upper case');
    assert.equal(subject.is_active, 1);

    const renamed = updateSubject(subject.id, { name: 'Renamed Subject', category: 'Renamed' });
    assert.equal(renamed.name, 'Renamed Subject');
    assert.equal(renamed.category, 'Renamed');

    const retired = setSubjectActive(subject.id, false);
    assert.equal(retired.is_active, 0);
    assert.equal(
      listSubjects({ activeOnly: true }).some((row) => row.id === subject.id),
      false,
      'retired subjects disappear from selection lists'
    );
    assert.equal(
      listSubjects({ activeOnly: false }).some((row) => row.id === subject.id),
      true,
      'but remain in the catalogue for history'
    );
    assert.equal(setSubjectActive(subject.id, true).is_active, 1);
  });

  test('duplicate codes and names are refused', () => {
    createSubject({ code: 'DUP1', name: 'Duplicate One' });
    assert.throws(() => createSubject({ code: 'DUP1', name: 'Something Else' }), DomainError);
    assert.throws(() => createSubject({ code: 'DUP2', name: 'Duplicate One' }), DomainError);
  });

  test('renaming onto an existing name is refused, and unknown ids fail cleanly', () => {
    const first = createSubject({ code: 'REN1', name: 'Rename Source' });
    createSubject({ code: 'REN2', name: 'Rename Target' });
    assert.throws(() => updateSubject(first.id, { name: 'Rename Target' }), DomainError);
    assert.throws(() => updateSubject(999999, { name: 'Whatever' }), DomainError);
    assert.throws(() => setSubjectActive(999999, false), DomainError);
    assert.equal(getSubject('abc'), null);
  });

  test('tutor counts only include published, active tutors', () => {
    const { subject, user } = makeTutor({ name: 'Counted Tutor' });
    const withCounts = subjectsWithTutorCounts({ activeOnly: false });
    const row = withCounts.find((item) => item.id === subject.id);
    assert.equal(row.tutor_count, 1);

    setUserStatus(user.id, 'suspended');
    const afterSuspension = subjectsWithTutorCounts({ activeOnly: false }).find(
      (item) => item.id === subject.id
    );
    assert.equal(afterSuspension.tutor_count, 0);
  });
});

describe('review moderation', () => {
  function completedBookingFor(tutorId, studentId, subjectId, hoursAgo) {
    const start = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
    const end = new Date(Date.now() - (hoursAgo - 1) * 3600 * 1000).toISOString();
    return ctx.database.run(
      `INSERT INTO bookings (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode,
                             location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', 'online', '', ?, ?)`,
      [studentId, tutorId, subjectId, start, end, nowIso(), nowIso()]
    ).lastInsertRowid;
  }

  test('hiding a review removes it from public view and from the rating', () => {
    const { user: tutor, subject } = makeTutor({ name: 'Reviewed Tutor' });
    const student = makeStudent();
    const bookingId = completedBookingFor(tutor.id, student.id, subject.id, 30);
    const review = createReview({ bookingId, studentId: student.id, rating: 5, comment: 'Abusive text' });

    assert.equal(getTutorProfile(tutor.id).rating_count, 1);

    setReviewHidden(review.id, true);
    assert.equal(getTutorProfile(tutor.id).rating_count, 0);
    assert.equal(getTutorProfile(tutor.id).rating_avg, 0);
    assert.equal(listReviewsForTutor(tutor.id).length, 0);
    assert.equal(listReviewsForTutor(tutor.id, { includeHidden: true }).length, 1);

    setReviewHidden(review.id, false);
    assert.equal(getTutorProfile(tutor.id).rating_count, 1);
    assert.equal(getTutorProfile(tutor.id).rating_avg, 5);
  });

  test('moderating an unknown review fails cleanly', () => {
    assert.throws(() => setReviewHidden(999999, true), DomainError);
  });
});

describe('statistics and audit trail', () => {
  test('platform stats count what they claim to count', () => {
    const stats = platformStats();
    const users = Number(ctx.database.value('SELECT COUNT(*) AS c FROM users'));
    const bookings = Number(ctx.database.value('SELECT COUNT(*) AS c FROM bookings'));
    assert.equal(stats.users.total, users);
    assert.equal(stats.bookings.total, bookings);
    assert.equal(
      stats.users.students + stats.users.tutors + listUsers({ role: 'admin' }).total,
      users
    );
    assert.ok(stats.subjects > 0);
    assert.ok(stats.tutorsPublished >= 0);
  });

  test('recent bookings are newest first and carry display names', () => {
    const rows = recentBookings(5);
    for (const row of rows) {
      assert.ok(row.student_name);
      assert.ok(row.tutor_name);
      assert.ok(row.subject_name);
    }
    const created = rows.map((row) => row.created_at);
    assert.deepEqual(created, [...created].sort().reverse());
  });

  test('audit entries record actor, action and target', () => {
    const admin = makeAdmin({ name: 'Auditing Admin' });
    recordAudit(admin.id, 'user.suspend', {
      targetType: 'user',
      targetId: 42,
      meta: { email: 'someone@test.local' },
    });

    const entries = listAudit({ limit: 10 });
    const entry = entries.find((item) => item.action === 'user.suspend' && item.actor_id === admin.id);
    assert.ok(entry, 'the action was logged');
    assert.equal(entry.target_type, 'user');
    assert.equal(entry.target_id, '42');
    assert.match(entry.meta, /someone@test.local/);
    assert.equal(entry.actor_name, 'Auditing Admin');
  });

  test('audit entries survive the actor being removed', () => {
    const admin = makeAdmin();
    recordAudit(admin.id, 'subject.retire', { targetType: 'subject', targetId: 7 });
    ctx.database.run('DELETE FROM users WHERE id = ?', [admin.id]);
    const entry = listAudit({ limit: 50 }).find((item) => item.action === 'subject.retire');
    assert.ok(entry, 'the log entry remains');
    assert.equal(entry.actor_id, null, 'the actor reference is nulled, not cascaded away');
  });
});

describe('statistics match what the pages claim (audit finding 2)', () => {
  test('subjectsCovered counts subjects a student can actually book', () => {
    const stats = platformStats();
    const expected = subjectsWithTutorCounts({ activeOnly: true }).filter(
      (subject) => subject.tutor_count > 0
    ).length;

    assert.equal(stats.subjectsCovered, expected);
    assert.ok(
      stats.subjects >= stats.subjectsCovered,
      'the catalogue is never smaller than the covered set'
    );
  });

  test('retiring a subject removes it from the covered count', () => {
    const { subject } = makeTutor({ name: 'Sole Tutor For Subject' });
    const before = platformStats().subjectsCovered;
    setSubjectActive(subject.id, false);
    assert.equal(platformStats().subjectsCovered, before - 1);
    setSubjectActive(subject.id, true);
    assert.equal(platformStats().subjectsCovered, before);
  });

  test('unpublishing the only tutor removes the subject from the covered count', () => {
    const { user, subject } = makeTutor({ name: 'Only Tutor Here' });
    const before = platformStats().subjectsCovered;
    assert.ok(before > 0);
    setPublished(user.id, false);
    const after = platformStats().subjectsCovered;
    assert.equal(after, before - 1, `${subject.name} should no longer count as covered`);
  });

  test('published tutor count matches the visibility rule used by search', () => {
    const stats = platformStats();
    const rows = Number(
      ctx.database.value(`
        SELECT COUNT(*) FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
         WHERE tp.is_published = 1 AND u.status = 'active'`)
    );
    assert.equal(stats.tutorsPublished, rows);
  });
});
