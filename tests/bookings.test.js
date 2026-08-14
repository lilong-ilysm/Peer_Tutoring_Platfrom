import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import config from '../src/config.js';
import { DomainError } from '../src/lib/errors.js';
import { nowIso } from '../src/lib/time.js';
import { addTimeOff, generateSlots, listBlocks, removeBlock } from '../src/services/availability.js';
import {
  acceptBooking,
  bookingCountsFor,
  cancelBooking,
  createBooking,
  declineBooking,
  getBookingForUser,
  listBookingsForUser,
  settleElapsedBookings,
} from '../src/services/bookings.js';
import { unreadCount } from '../src/services/notifications.js';
import { addTutorSubject, setPublished } from '../src/services/tutors.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, makeSubjectRecord, makeTutor } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

function firstSlot(tutorId, index = 0) {
  const slots = generateSlots(tutorId);
  assert.ok(slots.length > index, 'fixture tutor should have bookable slots');
  return slots[index];
}

function insertBooking({ studentId, tutorId, subjectId, startsAt, endsAt, status }) {
  return ctx.database.run(
    `INSERT INTO bookings (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode,
                           location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'online', '', ?, ?)`,
    [studentId, tutorId, subjectId, startsAt, endsAt, status, nowIso(), nowIso()]
  ).lastInsertRowid;
}

describe('creating a booking', () => {
  test('a student can request an available slot and the tutor is notified', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const slot = firstSlot(tutor.id);

    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
      note: 'I need help with question 3.',
    });

    assert.equal(booking.status, 'pending');
    assert.equal(booking.starts_at, slot.startsAt);
    assert.equal(booking.mode, 'online');
    assert.equal(booking.student_id, student.id);
    assert.equal(unreadCount(tutor.id), 1, 'the tutor gets exactly one notification');
    assert.equal(unreadCount(student.id), 0, 'the student is not notified about their own action');
  });

  test('the same slot cannot be booked twice', () => {
    const { user: tutor, subject } = makeTutor();
    const first = makeStudent();
    const second = makeStudent();
    const slot = firstSlot(tutor.id);

    createBooking({ studentId: first.id, tutorId: tutor.id, subjectId: subject.id, startsAt: slot.startsAt });

    assert.throws(
      () =>
        createBooking({
          studentId: second.id,
          tutorId: tutor.id,
          subjectId: subject.id,
          startsAt: slot.startsAt,
        }),
      (error) => error instanceof DomainError && error.status === 409
    );

    const count = ctx.database.value(
      "SELECT COUNT(*) AS c FROM bookings WHERE tutor_id = ? AND starts_at = ? AND status IN ('pending','confirmed')",
      [tutor.id, slot.startsAt]
    );
    assert.equal(Number(count), 1, 'only one live booking exists for that slot');
  });

  test('the database rejects a duplicate live slot even if the service check is bypassed', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const other = makeStudent();
    const slot = firstSlot(tutor.id);
    insertBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: 'confirmed',
    });

    assert.throws(() =>
      insertBooking({
        studentId: other.id,
        tutorId: tutor.id,
        subjectId: subject.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'pending',
      })
    );
  });

  test('a student cannot double-book themselves at the same time', () => {
    const first = makeTutor();
    const second = makeTutor();
    const student = makeStudent();
    const slot = firstSlot(first.user.id);
    createBooking({
      studentId: student.id,
      tutorId: first.user.id,
      subjectId: first.subject.id,
      startsAt: slot.startsAt,
    });

    const clash = generateSlots(second.user.id).find((candidate) => candidate.startsAt === slot.startsAt);
    assert.ok(clash, 'both fixture tutors offer the same slot');
    assert.throws(
      () =>
        createBooking({
          studentId: student.id,
          tutorId: second.user.id,
          subjectId: second.subject.id,
          startsAt: clash.startsAt,
        }),
      (error) => error instanceof DomainError && /already have a session/.test(error.message)
    );
  });

  test('rejects a subject the tutor does not teach', () => {
    const { user: tutor } = makeTutor();
    const student = makeStudent();
    const other = makeSubjectRecord({ code: 'OTHER1', name: 'Unrelated Subject' });
    assert.throws(
      () =>
        createBooking({
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: other.id,
          startsAt: firstSlot(tutor.id).startsAt,
        }),
      (error) => error instanceof DomainError && /does not tutor/.test(error.message)
    );
  });

  test('rejects a slot that is not offered', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    for (const startsAt of ['2020-01-01T09:00:00.000Z', 'not-a-date', new Date(Date.now() + 60000).toISOString()]) {
      assert.throws(
        () => createBooking({ studentId: student.id, tutorId: tutor.id, subjectId: subject.id, startsAt }),
        DomainError,
        `expected rejection for ${startsAt}`
      );
    }
  });

  test('rejects an unpublished tutor', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const slot = firstSlot(tutor.id);
    setPublished(tutor.id, false);
    assert.throws(
      () =>
        createBooking({
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: subject.id,
          startsAt: slot.startsAt,
        }),
      (error) => error instanceof DomainError && /not accepting bookings/.test(error.message)
    );
  });

  test('a tutor cannot request a session, and nobody can book themselves', () => {
    const { user: tutor, subject } = makeTutor();
    assert.throws(
      () =>
        createBooking({
          studentId: tutor.id,
          tutorId: tutor.id,
          subjectId: subject.id,
          startsAt: firstSlot(tutor.id).startsAt,
        }),
      (error) => error instanceof DomainError && error.status === 403
    );
  });

  test('a mode must be chosen when the tutor offers both', () => {
    const { user: tutor, subject } = makeTutor({ mode: 'both' });
    const student = makeStudent();
    const slot = firstSlot(tutor.id);
    assert.throws(
      () =>
        createBooking({
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: subject.id,
          startsAt: slot.startsAt,
        }),
      (error) => error instanceof DomainError && /online or in person/i.test(error.message)
    );
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
      mode: 'in_person',
    });
    assert.equal(booking.mode, 'in_person');
    assert.equal(booking.location, 'Library room 1', 'the campus location is copied onto the booking');
  });

  test('a student is capped at the configured number of open requests', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const slots = generateSlots(tutor.id);
    for (let index = 0; index < config.maxActiveRequests; index += 1) {
      createBooking({
        studentId: student.id,
        tutorId: tutor.id,
        subjectId: subject.id,
        startsAt: slots[index].startsAt,
      });
    }
    assert.throws(
      () =>
        createBooking({
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: subject.id,
          startsAt: slots[config.maxActiveRequests].startsAt,
        }),
      (error) => error instanceof DomainError && /requests waiting/.test(error.message)
    );
  });
});

describe('status transitions', () => {
  function scenario() {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: firstSlot(tutor.id).startsAt,
    });
    return { tutor, student, subject, booking };
  }

  test('only the tutor can accept', () => {
    const { student, booking, tutor } = scenario();
    assert.throws(
      () => acceptBooking(booking.id, student),
      (error) => error instanceof DomainError && error.status === 403
    );
    const accepted = acceptBooking(booking.id, tutor);
    assert.equal(accepted.status, 'confirmed');
  });

  test('accepting twice is refused', () => {
    const { booking, tutor } = scenario();
    acceptBooking(booking.id, tutor);
    assert.throws(
      () => acceptBooking(booking.id, tutor),
      (error) => error instanceof DomainError && error.status === 409
    );
  });

  test('a declined request cannot then be accepted', () => {
    const { booking, tutor } = scenario();
    const declined = declineBooking(booking.id, tutor, 'Clashes with a lab.');
    assert.equal(declined.status, 'declined');
    assert.equal(declined.tutor_note, 'Clashes with a lab.');
    assert.throws(() => acceptBooking(booking.id, tutor), DomainError);
  });

  test('a student cannot decline their own request', () => {
    const { booking, student } = scenario();
    assert.throws(
      () => declineBooking(booking.id, student, 'nope'),
      (error) => error instanceof DomainError && error.status === 403
    );
  });

  test('cancelling needs a reason and notifies the other party', () => {
    const { booking, student, tutor } = scenario();
    assert.throws(() => cancelBooking(booking.id, student, ''), DomainError);
    assert.throws(() => cancelBooking(booking.id, student, 'x'), DomainError);

    const before = unreadCount(tutor.id);
    const cancelled = cancelBooking(booking.id, student, 'Family emergency, sorry.');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelled_by, student.id);
    assert.equal(cancelled.cancel_reason, 'Family emergency, sorry.');
    assert.equal(unreadCount(tutor.id), before + 1);
  });

  test('a stranger cannot cancel someone else’s session', () => {
    const { booking } = scenario();
    const stranger = makeStudent();
    assert.throws(
      () => cancelBooking(booking.id, stranger, 'I feel like it'),
      (error) => error instanceof DomainError && error.status === 403
    );
  });

  test('a cancelled session cannot be cancelled again', () => {
    const { booking, student } = scenario();
    cancelBooking(booking.id, student, 'Double booked myself.');
    assert.throws(() => cancelBooking(booking.id, student, 'again'), DomainError);
  });

  test('transitions on a missing booking are refused', () => {
    const { tutor } = scenario();
    assert.throws(() => acceptBooking(999999, tutor), DomainError);
  });
});

describe('elapsed sessions', () => {
  test('confirmed sessions in the past complete themselves', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const start = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const id = insertBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: start,
      endsAt: end,
      status: 'confirmed',
    });

    settleElapsedBookings();
    assert.equal(ctx.database.get('SELECT status FROM bookings WHERE id = ?', [id]).status, 'completed');
  });

  test('pending requests whose time passed are closed with an explanation', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const start = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const id = insertBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: start,
      endsAt: end,
      status: 'pending',
    });

    settleElapsedBookings();
    const row = ctx.database.get('SELECT status, cancel_reason FROM bookings WHERE id = ?', [id]);
    assert.equal(row.status, 'cancelled');
    assert.match(row.cancel_reason, /expired/);
    assert.ok(unreadCount(student.id) > 0, 'the student is told the request expired');
  });

  test('completed sessions are left alone on a second pass', () => {
    const before = ctx.database.value("SELECT COUNT(*) AS c FROM bookings WHERE status = 'completed'");
    settleElapsedBookings();
    const after = ctx.database.value("SELECT COUNT(*) AS c FROM bookings WHERE status = 'completed'");
    assert.equal(Number(after), Number(before));
  });
});

describe('visibility and lists', () => {
  test('only participants (and admins) can load a booking', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const stranger = makeStudent();
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: firstSlot(tutor.id).startsAt,
    });

    assert.ok(getBookingForUser(booking.id, student));
    assert.ok(getBookingForUser(booking.id, tutor));
    assert.equal(getBookingForUser(booking.id, stranger), null);
    assert.equal(getBookingForUser(999999, student), null);
  });

  test('lists are scoped to the caller and to the requested scope', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const stranger = makeStudent();
    createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: firstSlot(tutor.id).startsAt,
    });

    assert.equal(listBookingsForUser(stranger, { scope: 'all' }).total, 0);
    assert.equal(listBookingsForUser(student, { scope: 'pending' }).total, 1);
    assert.equal(listBookingsForUser(tutor, { scope: 'pending' }).total, 1);
    assert.equal(bookingCountsFor(student).pending, 1);
    assert.equal(bookingCountsFor(stranger).total, 0);
  });

  test('a subject can be added and immediately booked', () => {
    const { user: tutor } = makeTutor();
    const extra = makeSubjectRecord({ code: 'EXTRA1', name: 'Extra Subject' });
    addTutorSubject(tutor.id, extra.id, 'intermediate');
    const student = makeStudent();
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: extra.id,
      startsAt: firstSlot(tutor.id).startsAt,
    });
    assert.equal(booking.subject_name, 'Extra Subject');
  });
});

/**
 * Audit scenario D: a tutor changes availability after a booking already exists.
 * The agreed session must survive; the slot must stop being offered.
 */
describe('availability changes after a booking exists (scenario D)', () => {
  test('removing the block does not touch the agreed session, but withdraws the slot', () => {
    const { user: tutor, subject } = makeTutor({
      blocks: [[0, 8 * 60, 20 * 60], [1, 8 * 60, 20 * 60], [2, 8 * 60, 20 * 60], [3, 8 * 60, 20 * 60], [4, 8 * 60, 20 * 60], [5, 8 * 60, 20 * 60], [6, 8 * 60, 20 * 60]],
    });
    const student = makeStudent();
    const slot = firstSlot(tutor.id);

    const booking = acceptBooking(
      createBooking({
        studentId: student.id,
        tutorId: tutor.id,
        subjectId: subject.id,
        startsAt: slot.startsAt,
      }).id,
      tutor
    );
    assert.equal(booking.status, 'confirmed');

    // The tutor now removes every block, i.e. withdraws all availability.
    for (const block of listBlocks(tutor.id)) removeBlock(tutor.id, block.id);

    const stillThere = getBookingForUser(booking.id, student);
    assert.ok(stillThere, 'the student can still see the session');
    assert.equal(stillThere.status, 'confirmed', 'an agreed session is not silently dropped');
    assert.equal(stillThere.starts_at, slot.startsAt, 'its time is unchanged');
    assert.deepEqual(generateSlots(tutor.id), [], 'no new slots are offered');
  });

  test('marking time off is refused while a session on that date is live', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const slot = firstSlot(tutor.id);
    createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
    });

    assert.throws(
      () => addTimeOff(tutor.id, { date: slot.dateKey, note: 'Away' }),
      (error) => error instanceof DomainError && /still have a session booked/.test(error.message)
    );
  });

  test('after the session is cancelled, the tutor can mark that date off', () => {
    const { user: tutor, subject } = makeTutor();
    const student = makeStudent();
    const slot = firstSlot(tutor.id);
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
    });

    cancelBooking(booking.id, tutor, 'Timetable clash, sorry.');
    assert.ok(addTimeOff(tutor.id, { date: slot.dateKey, note: 'Away' }));
    assert.equal(
      generateSlots(tutor.id).some((candidate) => candidate.dateKey === slot.dateKey),
      false,
      'the whole day is withdrawn'
    );
  });
});
