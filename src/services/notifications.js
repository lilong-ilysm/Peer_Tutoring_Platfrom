/**
 * In-app notifications.
 *
 * Notifications are the mechanism that keeps the booking loop moving: without
 * them a tutor never learns a request is waiting (spec section 2.2).
 * A notification is only ever readable by its owner (AC-34).
 */
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/time.js';

export const NOTIFICATION_TYPES = Object.freeze({
  BOOKING_REQUESTED: 'booking_requested',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_DECLINED: 'booking_declined',
  BOOKING_CANCELLED: 'booking_cancelled',
  MESSAGE_RECEIVED: 'message_received',
  REVIEW_RECEIVED: 'review_received',
  ACCOUNT: 'account',
});

/**
 * Record a notification for one user.
 * @param {number} userId recipient
 * @param {{type:string, title:string, body?:string, link?:string}} payload
 */
export function notify(userId, { type, title, body = '', link = '' }) {
  const db = getDb();
  const { lastInsertRowid } = db.run(
    `INSERT INTO notifications (user_id, type, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(userId), type, String(title).slice(0, 160), String(body).slice(0, 400), link, nowIso()]
  );
  return lastInsertRowid;
}

export function listNotifications(userId, { limit = 50, onlyUnread = false } = {}) {
  const db = getDb();
  const clause = onlyUnread ? 'AND read_at IS NULL' : '';
  return db.all(
    `SELECT * FROM notifications
      WHERE user_id = ? ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [Number(userId), Math.min(Math.max(1, limit), 200)]
  );
}

export function unreadCount(userId) {
  return Number(
    getDb().value(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [Number(userId)]
    ) || 0
  );
}

export function getNotification(userId, id) {
  return (
    getDb().get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [
      Number(id),
      Number(userId),
    ]) || null
  );
}

/** Mark one notification read. Scoped by user_id so it cannot touch another's. */
export function markRead(userId, id) {
  return getDb().run(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
    [nowIso(), Number(id), Number(userId)]
  ).changes;
}

export function markAllRead(userId) {
  return getDb().run(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
    [nowIso(), Number(userId)]
  ).changes;
}
