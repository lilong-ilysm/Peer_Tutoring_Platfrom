/**
 * Reviews and tutor rating aggregates.
 *
 * A review is only possible on a session that actually happened: the reviewer
 * must be the booking's student, the booking must be `completed`, and there can
 * be exactly one review per booking (business rule 14, AC-35/36).
 *
 * `tutor_profiles.rating_avg` / `rating_count` are derived values, recomputed
 * from non-hidden reviews on every write - never edited by hand (AC-37/41).
 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';

const REVIEW_SELECT = `
  SELECT r.*, u.full_name AS student_name, t.full_name AS tutor_name,
         b.starts_at, s.name AS subject_name
    FROM reviews r
    JOIN users u ON u.id = r.student_id
    JOIN users t ON t.id = r.tutor_id
    JOIN bookings b ON b.id = r.booking_id
    JOIN subjects s ON s.id = b.subject_id
`;

/** Recompute a tutor's aggregate from visible reviews. */
export function recomputeTutorRating(tutorId) {
  const db = getDb();
  const row = db.get(
    'SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE tutor_id = ? AND is_hidden = 0',
    [Number(tutorId)]
  );
  const count = Number(row?.count || 0);
  const average = count ? Math.round(Number(row.average) * 100) / 100 : 0;
  db.run('UPDATE tutor_profiles SET rating_avg = ?, rating_count = ?, updated_at = ? WHERE user_id = ?', [
    average,
    count,
    nowIso(),
    Number(tutorId),
  ]);
  return { average, count };
}

export function getReviewByBooking(bookingId) {
  return getDb().get(`${REVIEW_SELECT} WHERE r.booking_id = ?`, [Number(bookingId)]) || null;
}

export function getReview(id) {
  return getDb().get(`${REVIEW_SELECT} WHERE r.id = ?`, [Number(id)]) || null;
}

/**
 * @param {{bookingId:number, studentId:number, rating:number, comment?:string}} input
 */
export function createReview({ bookingId, studentId, rating, comment = '' }) {
  const db = getDb();
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new DomainError('Choose a rating between 1 and 5 stars.');
  }

  return db.transaction(() => {
    const booking = db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
    if (!booking) throw new DomainError('Session not found.', { status: 404 });
    if (booking.student_id !== Number(studentId)) {
      throw new DomainError('Only the student who attended can review this session.', {
        status: 403,
      });
    }
    if (booking.status !== 'completed') {
      throw new DomainError('You can only review a session once it has taken place.', {
        status: 409,
      });
    }
    const existing = db.get('SELECT id FROM reviews WHERE booking_id = ?', [booking.id]);
    if (existing) {
      throw new DomainError('You have already reviewed this session.', { status: 409 });
    }

    const { lastInsertRowid } = db.run(
      `INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        booking.id,
        booking.student_id,
        booking.tutor_id,
        numericRating,
        String(comment || '').slice(0, config.limits.reviewLength),
        nowIso(),
      ]
    );

    recomputeTutorRating(booking.tutor_id);

    notify(booking.tutor_id, {
      type: NOTIFICATION_TYPES.REVIEW_RECEIVED,
      title: `You received a ${numericRating}-star review`,
      body: String(comment || '').slice(0, 160),
      link: `/tutors/${booking.tutor_id}#reviews`,
    });

    return getReview(lastInsertRowid);
  });
}

export function listReviewsForTutor(tutorId, { limit = 20, includeHidden = false } = {}) {
  const clause = includeHidden ? '' : 'AND r.is_hidden = 0';
  return getDb().all(
    `${REVIEW_SELECT} WHERE r.tutor_id = ? ${clause} ORDER BY r.created_at DESC LIMIT ?`,
    [Number(tutorId), Math.min(Math.max(1, limit), 100)]
  );
}

/** Admin moderation: hide or restore a review, then refresh the aggregate. */
export function setReviewHidden(reviewId, hidden) {
  const db = getDb();
  const review = getReview(reviewId);
  if (!review) throw new DomainError('Review not found.', { status: 404 });
  db.run('UPDATE reviews SET is_hidden = ? WHERE id = ?', [hidden ? 1 : 0, review.id]);
  recomputeTutorRating(review.tutor_id);
  return getReview(review.id);
}

export function listReviews({ page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const total = Number(db.value('SELECT COUNT(*) AS c FROM reviews') || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = db.all(`${REVIEW_SELECT} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [
    pageSize,
    (current - 1) * pageSize,
  ]);
  return { rows, total, page: current, totalPages };
}
