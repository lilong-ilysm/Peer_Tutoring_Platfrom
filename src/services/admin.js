/**
 * Administration: platform statistics and the audit trail.
 *
 * Every administrative mutation is recorded, because privileged action without
 * a record is not accountable (spec section 2.2).
 */
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/time.js';

/**
 * Record an administrative action.
 * @param {number} actorId admin user id
 * @param {string} action machine-readable verb, e.g. `user.suspend`
 * @param {{targetType?:string, targetId?:string|number, meta?:object|string}} [details]
 */
export function recordAudit(actorId, action, { targetType = '', targetId = '', meta = '' } = {}) {
  const serialisedMeta = typeof meta === 'string' ? meta : JSON.stringify(meta ?? '');
  return getDb().run(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actorId ? Number(actorId) : null,
      String(action).slice(0, 80),
      String(targetType).slice(0, 40),
      String(targetId).slice(0, 40),
      String(serialisedMeta).slice(0, 500),
      nowIso(),
    ]
  ).lastInsertRowid;
}

export function listAudit({ limit = 100 } = {}) {
  return getDb().all(
    `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?`,
    [Math.min(Math.max(1, limit), 500)]
  );
}

/** Single round-trip snapshot for the admin overview. */
export function platformStats() {
  const db = getDb();
  const users = db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS students,
      SUM(CASE WHEN role = 'tutor' THEN 1 ELSE 0 END) AS tutors,
      SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
    FROM users
  `);
  const bookings = db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS declined
    FROM bookings
  `);
  const published = Number(
    db.value(`
      SELECT COUNT(*) AS c
        FROM tutor_profiles tp
        JOIN users u ON u.id = tp.user_id
       WHERE tp.is_published = 1 AND u.status = 'active'
    `) || 0
  );
  const reviews = db.get(
    'SELECT COUNT(*) AS total, AVG(rating) AS average FROM reviews WHERE is_hidden = 0'
  );

  return {
    users: {
      total: Number(users?.total || 0),
      students: Number(users?.students || 0),
      tutors: Number(users?.tutors || 0),
      suspended: Number(users?.suspended || 0),
    },
    tutorsPublished: published,
    bookings: {
      total: Number(bookings?.total || 0),
      pending: Number(bookings?.pending || 0),
      confirmed: Number(bookings?.confirmed || 0),
      completed: Number(bookings?.completed || 0),
      cancelled: Number(bookings?.cancelled || 0),
      declined: Number(bookings?.declined || 0),
    },
    reviews: {
      total: Number(reviews?.total || 0),
      average: reviews?.average ? Math.round(Number(reviews.average) * 100) / 100 : 0,
    },
    subjects: Number(db.value('SELECT COUNT(*) AS c FROM subjects WHERE is_active = 1') || 0),
  };
}

/** Most recent bookings, for the admin overview activity list. */
export function recentBookings(limit = 8) {
  return getDb().all(
    `SELECT b.id, b.status, b.starts_at, b.created_at,
            s.name AS subject_name,
            stu.full_name AS student_name,
            tut.full_name AS tutor_name
       FROM bookings b
       JOIN subjects s ON s.id = b.subject_id
       JOIN users stu ON stu.id = b.student_id
       JOIN users tut ON tut.id = b.tutor_id
      ORDER BY b.created_at DESC
      LIMIT ?`,
    [Math.min(Math.max(1, limit), 50)]
  );
}
