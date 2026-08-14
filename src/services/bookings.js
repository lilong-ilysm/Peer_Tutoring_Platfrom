/**
 * Session bookings: the transaction at the heart of the platform.
 *
 * Status machine (spec business rules 9-13):
 *
 *   pending ──accept──> confirmed ──(end time passes)──> completed
 *      │                    │
 *      ├──decline──> declined
 *      └──cancel───> cancelled <──cancel──┘
 *
 * `declined`, `cancelled` and `completed` are terminal.
 *
 * Authorisation is enforced here, not in the UI: every mutation re-checks that
 * the caller is the right participant for that transition (AC-30, AC-11).
 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { formatDateTime, nowIso } from '../lib/time.js';
import { findSlot } from './availability.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';
import { getActiveSubject } from './subjects.js';
import { getTutorProfile, teachesSubject } from './tutors.js';
import { findUserById } from './users.js';

export const BOOKING_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'declined',
  'cancelled',
  'completed',
]);

const ACTIVE_STATUSES = Object.freeze(['pending', 'confirmed']);

const BOOKING_SELECT = `
  SELECT b.*,
         s.name AS subject_name,
         s.code AS subject_code,
         stu.full_name AS student_name,
         tut.full_name AS tutor_name,
         (SELECT r.id FROM reviews r WHERE r.booking_id = b.id) AS review_id
    FROM bookings b
    JOIN subjects s ON s.id = b.subject_id
    JOIN users stu ON stu.id = b.student_id
    JOIN users tut ON tut.id = b.tutor_id
`;

/**
 * Bring elapsed bookings up to date. Called lazily from read paths so no
 * background scheduler is needed and the status a user sees is always current.
 *
 *  - confirmed sessions past their end time become `completed` (AC-29),
 *  - pending requests whose start time passed unanswered are closed as
 *    `cancelled` with an explanatory reason, so a student is never left waiting
 *    on a request that can no longer happen.
 */
export function settleElapsedBookings() {
  const db = getDb();
  const timestamp = nowIso();

  const completed = db.run(
    `UPDATE bookings
        SET status = 'completed', updated_at = ?
      WHERE status = 'confirmed' AND ends_at <= ?`,
    [timestamp, timestamp]
  ).changes;

  const stale = db.all(
    `SELECT b.id, b.student_id, b.tutor_id, b.starts_at,
            s.name AS subject_name, tut.full_name AS tutor_name
       FROM bookings b
       JOIN subjects s ON s.id = b.subject_id
       JOIN users tut ON tut.id = b.tutor_id
      WHERE b.status = 'pending' AND b.starts_at <= ?`,
    [timestamp]
  );

  for (const booking of stale) {
    const result = db.run(
      `UPDATE bookings
          SET status = 'cancelled',
              cancel_reason = 'The request expired: the session time passed without a response.',
              updated_at = ?
        WHERE id = ? AND status = 'pending'`,
      [timestamp, booking.id]
    );
    if (!result.changes) continue;
    notify(booking.student_id, {
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title: 'A session request expired',
      body: `${booking.subject_name} with ${booking.tutor_name} on ${formatDateTime(
        booking.starts_at,
        { withZone: true }
      )} was never answered.`,
      link: `/bookings/${booking.id}`,
    });
    notify(booking.tutor_id, {
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title: 'A session request expired',
      body: `You did not respond to a request for ${booking.subject_name} on ${formatDateTime(
        booking.starts_at,
        { withZone: true }
      )}.`,
      link: `/bookings/${booking.id}`,
    });
  }

  return completed + stale.length;
}

export function getBooking(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return null;
  return getDb().get(`${BOOKING_SELECT} WHERE b.id = ?`, [numeric]) || null;
}

/**
 * Fetch a booking the given user is allowed to see.
 * Non-participants get 404 rather than 403 so the existence of another user's
 * booking is not disclosed.
 */
export function getBookingForUser(id, user) {
  settleElapsedBookings();
  const booking = getBooking(id);
  if (!booking) return null;
  if (user.role === 'admin') return booking;
  if (booking.student_id === user.id || booking.tutor_id === user.id) return booking;
  return null;
}

export function isParticipant(booking, userId) {
  return booking.student_id === userId || booking.tutor_id === userId;
}

/** Pending requests a student currently holds (business rule 10). */
export function countActiveRequests(studentId) {
  return Number(
    getDb().value("SELECT COUNT(*) AS c FROM bookings WHERE student_id = ? AND status = 'pending'", [
      Number(studentId),
    ]) || 0
  );
}

/**
 * Create a booking request.
 * @param {{studentId:number, tutorId:number, subjectId:number, startsAt:string,
 *   mode?:string, note?:string}} input
 */
export function createBooking({ studentId, tutorId, subjectId, startsAt, mode, note = '' }) {
  const db = getDb();
  const student = findUserById(studentId);
  const tutor = findUserById(tutorId);

  if (!student || student.role !== 'student') {
    throw new DomainError('Only student accounts can request sessions.', { status: 403 });
  }
  if (!tutor || tutor.role !== 'tutor' || tutor.status !== 'active') {
    throw new DomainError('That tutor is not available.', { status: 404 });
  }
  if (Number(studentId) === Number(tutorId)) {
    throw new DomainError('You cannot book a session with yourself.');
  }

  const profile = getTutorProfile(tutorId);
  if (!profile.is_published) {
    throw new DomainError('That tutor is not accepting bookings at the moment.', { status: 409 });
  }

  const subject = getActiveSubject(subjectId);
  if (!subject) throw new DomainError('Choose a subject from the list.');
  if (!teachesSubject(tutorId, subject.id)) {
    throw new DomainError(`${tutor.full_name} does not tutor ${subject.name}.`);
  }

  const resolvedMode = resolveMode(profile, mode);
  const location = resolvedMode === 'online' ? profile.meeting_link : profile.campus;

  if (countActiveRequests(studentId) >= config.maxActiveRequests) {
    throw new DomainError(
      `You already have ${config.maxActiveRequests} requests waiting for a reply. Cancel one before making another.`,
      { status: 409 }
    );
  }

  const cleanNote = String(note || '').slice(0, config.limits.noteLength);

  // The slot check and the insert must be atomic, otherwise two students could
  // both pass the check and both insert (AC-27).
  return db.transaction(() => {
    const slot = findSlot(tutorId, startsAt);
    if (!slot) {
      throw new DomainError(
        'That time is no longer available. Pick another slot from the tutor’s calendar.',
        { status: 409, code: 'slot_unavailable' }
      );
    }

    const overlap = db.get(
      `SELECT id FROM bookings
        WHERE tutor_id = ? AND status IN ('pending', 'confirmed')
          AND starts_at < ? AND ends_at > ?`,
      [Number(tutorId), slot.endsAt, slot.startsAt]
    );
    if (overlap) {
      throw new DomainError('Someone just booked that slot. Please choose another time.', {
        status: 409,
        code: 'slot_unavailable',
      });
    }

    const studentClash = db.get(
      `SELECT id FROM bookings
        WHERE student_id = ? AND status IN ('pending', 'confirmed')
          AND starts_at < ? AND ends_at > ?`,
      [Number(studentId), slot.endsAt, slot.startsAt]
    );
    if (studentClash) {
      throw new DomainError('You already have a session at that time.', { status: 409 });
    }

    const timestamp = nowIso();
    let inserted;
    try {
      inserted = db.run(
        `INSERT INTO bookings
           (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode, location,
            student_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        [
          Number(studentId),
          Number(tutorId),
          subject.id,
          slot.startsAt,
          slot.endsAt,
          resolvedMode,
          location || '',
          cleanNote,
          timestamp,
          timestamp,
        ]
      );
    } catch (error) {
      // The partial unique index is the last line of defence against a race.
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new DomainError('Someone just booked that slot. Please choose another time.', {
          status: 409,
          code: 'slot_unavailable',
        });
      }
      throw error;
    }

    notify(tutorId, {
      type: NOTIFICATION_TYPES.BOOKING_REQUESTED,
      title: `New session request from ${student.full_name}`,
      body: `${subject.name} on ${formatDateTime(slot.startsAt, { withZone: true })}`,
      link: `/bookings/${inserted.lastInsertRowid}`,
    });

    return getBooking(inserted.lastInsertRowid);
  });
}

function resolveMode(profile, requested) {
  if (profile.mode === 'both') {
    if (requested === 'online' || requested === 'in_person') return requested;
    throw new DomainError('Choose whether the session is online or in person.');
  }
  if (requested && requested !== profile.mode) {
    throw new DomainError('That session mode is not offered by this tutor.');
  }
  return profile.mode;
}

/* ---------------------------------------------------------- transitions --- */

function loadForTransition(bookingId) {
  const booking = getBooking(bookingId);
  if (!booking) throw new DomainError('Session not found.', { status: 404 });
  return booking;
}

/** Tutor accepts a pending request. */
export function acceptBooking(bookingId, actor) {
  const db = getDb();
  const booking = loadForTransition(bookingId);

  if (booking.tutor_id !== actor.id) {
    throw new DomainError('Only the tutor can accept this request.', { status: 403 });
  }
  if (booking.status !== 'pending') {
    throw new DomainError(`This request is already ${booking.status}.`, { status: 409 });
  }
  if (new Date(booking.starts_at) <= new Date()) {
    throw new DomainError('That session start time has passed. Decline it instead.', { status: 409 });
  }

  db.run("UPDATE bookings SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'pending'", [
    nowIso(),
    booking.id,
  ]);

  notify(booking.student_id, {
    type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
    title: `${booking.tutor_name} accepted your session`,
    body: `${booking.subject_name} on ${formatDateTime(booking.starts_at, { withZone: true })}`,
    link: `/bookings/${booking.id}`,
  });

  return getBooking(booking.id);
}

/** Tutor declines a pending request, with an optional reason. */
export function declineBooking(bookingId, actor, note = '') {
  const db = getDb();
  const booking = loadForTransition(bookingId);

  if (booking.tutor_id !== actor.id) {
    throw new DomainError('Only the tutor can decline this request.', { status: 403 });
  }
  if (booking.status !== 'pending') {
    throw new DomainError(`This request is already ${booking.status}.`, { status: 409 });
  }

  db.run(
    "UPDATE bookings SET status = 'declined', tutor_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    [String(note || '').slice(0, config.limits.noteLength), nowIso(), booking.id]
  );

  notify(booking.student_id, {
    type: NOTIFICATION_TYPES.BOOKING_DECLINED,
    title: `${booking.tutor_name} declined your request`,
    body: note
      ? `Reason: ${String(note).slice(0, 200)}`
      : `${booking.subject_name} on ${formatDateTime(booking.starts_at, { withZone: true })}`,
    link: `/bookings/${booking.id}`,
  });

  return getBooking(booking.id);
}

/** Either participant cancels; a reason is mandatory (business rule 12). */
export function cancelBooking(bookingId, actor, reason) {
  const db = getDb();
  const booking = loadForTransition(bookingId);

  if (!isParticipant(booking, actor.id)) {
    throw new DomainError('You are not part of this session.', { status: 403 });
  }
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new DomainError(`This session is already ${booking.status}.`, { status: 409 });
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 3) {
    throw new DomainError('Please give a short reason so the other person knows what happened.');
  }

  db.run(
    `UPDATE bookings
        SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'confirmed')`,
    [actor.id, cleanReason.slice(0, config.limits.noteLength), nowIso(), booking.id]
  );

  const recipientId = booking.student_id === actor.id ? booking.tutor_id : booking.student_id;
  notify(recipientId, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: `${actor.full_name} cancelled a session`,
    body: `${booking.subject_name} on ${formatDateTime(booking.starts_at, {
      withZone: true,
    })} - ${cleanReason.slice(0, 160)}`,
    link: `/bookings/${booking.id}`,
  });

  return getBooking(booking.id);
}

/* ---------------------------------------------------------------- lists --- */

/**
 * Bookings visible to a user, filtered by scope.
 * @param {object} user
 * @param {{scope?:'upcoming'|'pending'|'past'|'all', page?:number, pageSize?:number}} [options]
 */
export function listBookingsForUser(user, { scope = 'upcoming', page = 1, pageSize = 10 } = {}) {
  settleElapsedBookings();
  const db = getDb();
  const where = [];
  const params = [];

  if (user.role === 'student') {
    where.push('b.student_id = ?');
    params.push(user.id);
  } else if (user.role === 'tutor') {
    where.push('b.tutor_id = ?');
    params.push(user.id);
  }

  let order = 'b.starts_at ASC';
  if (scope === 'upcoming') {
    where.push("b.status IN ('pending', 'confirmed') AND b.ends_at > ?");
    params.push(nowIso());
  } else if (scope === 'pending') {
    where.push("b.status = 'pending'");
  } else if (scope === 'past') {
    where.push("(b.status IN ('completed', 'declined', 'cancelled') OR b.ends_at <= ?)");
    params.push(nowIso());
    order = 'b.starts_at DESC';
  } else {
    order = 'b.starts_at DESC';
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(
    db.value(`SELECT COUNT(*) AS c FROM bookings b ${clause}`, params) || 0
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const rows = db.all(`${BOOKING_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (current - 1) * pageSize,
  ]);

  return { rows, total, page: current, totalPages };
}

/** Counts used by the dashboards. */
export function bookingCountsFor(user) {
  settleElapsedBookings();
  const db = getDb();
  const column = user.role === 'tutor' ? 'tutor_id' : 'student_id';
  const row = db.get(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'confirmed' AND ends_at > ? THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status IN ('cancelled', 'declined') THEN 1 ELSE 0 END) AS closed,
       COUNT(*) AS total
     FROM bookings WHERE ${column} = ?`,
    [nowIso(), user.id]
  );
  return {
    pending: Number(row?.pending || 0),
    upcoming: Number(row?.upcoming || 0),
    completed: Number(row?.completed || 0),
    closed: Number(row?.closed || 0),
    total: Number(row?.total || 0),
  };
}

/** Completed sessions the student has not reviewed yet (review prompt). */
export function completedAwaitingReview(studentId, limit = 5) {
  settleElapsedBookings();
  return getDb().all(
    `${BOOKING_SELECT}
      WHERE b.student_id = ? AND b.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
      ORDER BY b.starts_at DESC
      LIMIT ?`,
    [Number(studentId), limit]
  );
}

export function nextSessionFor(user) {
  settleElapsedBookings();
  const column = user.role === 'tutor' ? 'tutor_id' : 'student_id';
  return (
    getDb().get(
      `${BOOKING_SELECT}
        WHERE b.${column} = ? AND b.status = 'confirmed' AND b.ends_at > ?
        ORDER BY b.starts_at ASC LIMIT 1`,
      [user.id, nowIso()]
    ) || null
  );
}

/** Status history for the session detail timeline. */
export function bookingTimeline(booking) {
  const events = [
    {
      label: `Requested by ${booking.student_name}`,
      at: booking.created_at,
    },
  ];
  if (booking.status === 'confirmed' || booking.status === 'completed') {
    events.push({ label: `Accepted by ${booking.tutor_name}`, at: booking.updated_at });
  }
  if (booking.status === 'declined') {
    events.push({
      label: `Declined by ${booking.tutor_name}`,
      at: booking.updated_at,
      detail: booking.tutor_note,
    });
  }
  if (booking.status === 'cancelled') {
    const who =
      booking.cancelled_by === booking.student_id ? booking.student_name : booking.tutor_name;
    events.push({
      label: `Cancelled by ${who}`,
      at: booking.updated_at,
      detail: booking.cancel_reason,
    });
  }
  if (booking.status === 'completed') {
    events.push({ label: 'Session completed', at: booking.ends_at });
  }
  return events;
}
