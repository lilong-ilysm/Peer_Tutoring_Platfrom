/**
 * Reviews, ratings and messaging rules.
 */
import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import config from '../src/config.js';
import { DomainError } from '../src/lib/errors.js';
import { nowIso } from '../src/lib/time.js';
import {
  counterpart,
  getConversationForUser,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  unreadMessageCount,
} from '../src/services/messages.js';
import { unreadCount } from '../src/services/notifications.js';
import {
  createReview,
  listReviewsForTutor,
  setReviewHidden,
} from '../src/services/reviews.js';
import { getTutorProfile, searchTutors } from '../src/services/tutors.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, makeTutor } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

let bookingOffset = 0;

/**
 * Insert a past booking directly. Each call uses a distinct start time so the
 * "one live booking per tutor slot" index is not tripped by the fixture itself.
 */
function completedBooking(tutorId, studentId, subjectId, { status = 'completed' } = {}) {
  bookingOffset += 1;
  const base = Date.now() - (26 + bookingOffset) * 3600 * 1000;
  const start = new Date(base).toISOString();
  const end = new Date(base + 3600 * 1000).toISOString();
  return ctx.database.run(
    `INSERT INTO bookings (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode,
                           location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'online', '', ?, ?)`,
    [studentId, tutorId, subjectId, start, end, status, nowIso(), nowIso()]
  ).lastInsertRowid;
}

describe('reviews', () => {
  test('a student can review a completed session once', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const bookingId = completedBooking(tutor.id, student.id, subject.id);

    const review = createReview({
      bookingId,
      studentId: student.id,
      rating: 5,
      comment: 'Genuinely helpful.',
    });
    assert.equal(review.rating, 5);
    assert.equal(unreadCount(tutor.id), 1, 'the tutor is notified');

    assert.throws(
      () => createReview({ bookingId, studentId: student.id, rating: 4 }),
      (error) => error instanceof DomainError && /already reviewed/.test(error.message)
    );
  });

  test('only the session’s student may review it', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const stranger = makeStudent();
    const bookingId = completedBooking(tutor.id, student.id, subject.id);

    assert.throws(
      () => createReview({ bookingId, studentId: stranger.id, rating: 5 }),
      (error) => error instanceof DomainError && error.status === 403
    );
  });

  test('sessions that did not complete cannot be reviewed', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    for (const status of ['pending', 'confirmed', 'declined', 'cancelled']) {
      const bookingId = completedBooking(tutor.id, student.id, subject.id, { status });
      assert.throws(
        () => createReview({ bookingId, studentId: student.id, rating: 5 }),
        (error) => error instanceof DomainError && error.status === 409,
        `expected ${status} to be unreviewable`
      );
    }
  });

  test('the rating must be a whole number from 1 to 5', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const bookingId = completedBooking(tutor.id, student.id, subject.id);
    for (const rating of [0, 6, -1, 2.5, 'five', null]) {
      assert.throws(
        () => createReview({ bookingId, studentId: student.id, rating }),
        DomainError,
        `expected ${rating} to be rejected`
      );
    }
  });

  test('the aggregate rating matches the visible reviews', () => {
    const { user: tutor, subject } = makeTutor();
    const ratings = [5, 4, 3];
    for (const rating of ratings) {
      const student = makeStudent();
      const bookingId = completedBooking(tutor.id, student.id, subject.id);
      createReview({ bookingId, studentId: student.id, rating });
    }

    const profile = getTutorProfile(tutor.id);
    assert.equal(profile.rating_count, 3);
    assert.equal(profile.rating_avg, 4);

    // Hiding one review recalculates the aggregate.
    const first = listReviewsForTutor(tutor.id)[0];
    setReviewHidden(first.id, true);
    const afterHide = getTutorProfile(tutor.id);
    assert.equal(afterHide.rating_count, 2);
    assert.equal(listReviewsForTutor(tutor.id).length, 2, 'hidden reviews are not shown publicly');
    assert.equal(
      listReviewsForTutor(tutor.id, { includeHidden: true }).length,
      3,
      'moderators can still see them'
    );

    setReviewHidden(first.id, false);
    assert.equal(getTutorProfile(tutor.id).rating_count, 3);
  });

  test('search can filter on the derived rating', () => {
    const { user: tutor, subject } = makeTutor({ name: 'Highly Rated Tutor' });
    const student = makeStudent();
    const bookingId = completedBooking(tutor.id, student.id, subject.id);
    createReview({ bookingId, studentId: student.id, rating: 5 });

    const strict = searchTutors({ minRating: 4.5 });
    assert.ok(strict.rows.some((row) => row.id === tutor.id));

    const impossible = searchTutors({ minRating: 5.1 });
    assert.equal(impossible.rows.length, 0);
  });
});

describe('messaging', () => {
  test('a conversation is created once per student/tutor pair', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const first = getOrCreateConversation(student.id, tutor.id);
    const second = getOrCreateConversation(student.id, tutor.id);
    assert.equal(first.id, second.id);
  });

  test('only participants can load a conversation', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const stranger = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);

    assert.ok(getConversationForUser(conversation.id, student.id));
    assert.ok(getConversationForUser(conversation.id, tutor.id));
    assert.equal(getConversationForUser(conversation.id, stranger.id), null);
    assert.equal(getConversationForUser(999999, student.id), null);
    assert.equal(getConversationForUser('abc', student.id), null);
  });

  test('a stranger cannot post into a conversation', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const stranger = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);

    assert.throws(
      () => sendMessage({ conversationId: conversation.id, senderId: stranger.id, body: 'hello' }),
      (error) => error instanceof DomainError && error.status === 404
    );
  });

  test('empty, whitespace-only and over-long messages are rejected', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);

    for (const body of ['', '   ', '\n\n', null, undefined]) {
      assert.throws(
        () => sendMessage({ conversationId: conversation.id, senderId: student.id, body }),
        DomainError
      );
    }
    assert.throws(
      () =>
        sendMessage({
          conversationId: conversation.id,
          senderId: student.id,
          body: 'x'.repeat(config.limits.messageLength + 1),
        }),
      (error) => error instanceof DomainError && /limited to/.test(error.message)
    );
    // Exactly at the limit is accepted.
    assert.ok(
      sendMessage({
        conversationId: conversation.id,
        senderId: student.id,
        body: 'y'.repeat(config.limits.messageLength),
      })
    );
  });

  test('message content is stored verbatim, including markup', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);
    const payload = '<script>alert("xss")</script>';
    sendMessage({ conversationId: conversation.id, senderId: student.id, body: payload });
    const messages = listMessages(conversation.id);
    assert.equal(messages[messages.length - 1].body, payload, 'escaping is a rendering concern');
  });

  test('unread counts follow the recipient, and clear when read', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);

    sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'First question' });
    sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'Second question' });

    assert.equal(unreadMessageCount(tutor.id), 2);
    assert.equal(unreadMessageCount(student.id), 0, 'your own messages are never unread for you');

    markConversationRead(conversation.id, tutor.id);
    assert.equal(unreadMessageCount(tutor.id), 0);

    sendMessage({ conversationId: conversation.id, senderId: tutor.id, body: 'Answer' });
    assert.equal(unreadMessageCount(student.id), 1);
  });

  test('the inbox shows the latest message and unread count per conversation', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);
    sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'Latest question' });

    const inbox = listConversations(tutor.id);
    const row = inbox.find((item) => item.id === conversation.id);
    assert.equal(row.last_body, 'Latest question');
    assert.equal(row.unread, 1);
    assert.equal(counterpart(row, tutor.id).id, student.id);
    assert.equal(counterpart(row, student.id).id, tutor.id);
  });

  test('incremental polling only returns newer messages', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const conversation = getOrCreateConversation(student.id, tutor.id);
    const first = sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'one' });
    const second = sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'two' });

    const after = listMessages(conversation.id, { afterId: first.id });
    assert.equal(after.length, 1);
    assert.equal(after[0].id, second.id);
  });

  test('a tutor cannot be the student side of a conversation', () => {
    const tutorA = makeTutor();
    const tutorB = makeTutor();
    assert.throws(
      () => getOrCreateConversation(tutorA.user.id, tutorB.user.id),
      (error) => error instanceof DomainError
    );
  });
});
