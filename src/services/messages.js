/**
 * Messaging: one conversation per student/tutor pair.
 *
 * Only the two participants may read or write a conversation, and that is
 * checked on every call rather than assumed from the UI (business rule 16,
 * AC-31/32).
 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';
import { findUserById } from './users.js';

/** Find or create the conversation between a student and a tutor. */
export function getOrCreateConversation(studentId, tutorId) {
  const db = getDb();
  const student = findUserById(studentId);
  const tutor = findUserById(tutorId);

  if (!student || student.role !== 'student') {
    throw new DomainError('Conversations are between a student and a tutor.', { status: 400 });
  }
  if (!tutor || tutor.role !== 'tutor') {
    throw new DomainError('That tutor could not be found.', { status: 404 });
  }

  const existing = db.get('SELECT * FROM conversations WHERE student_id = ? AND tutor_id = ?', [
    student.id,
    tutor.id,
  ]);
  if (existing) return existing;

  const { lastInsertRowid } = db.run(
    'INSERT INTO conversations (student_id, tutor_id, created_at) VALUES (?, ?, ?)',
    [student.id, tutor.id, nowIso()]
  );
  return db.get('SELECT * FROM conversations WHERE id = ?', [lastInsertRowid]);
}

/** The conversation, or null when the user is not a participant. */
export function getConversationForUser(conversationId, userId) {
  const numeric = Number(conversationId);
  if (!Number.isInteger(numeric)) return null;
  const row = getDb().get(
    `SELECT c.*,
            stu.full_name AS student_name,
            tut.full_name AS tutor_name
       FROM conversations c
       JOIN users stu ON stu.id = c.student_id
       JOIN users tut ON tut.id = c.tutor_id
      WHERE c.id = ?`,
    [numeric]
  );
  if (!row) return null;
  if (row.student_id !== Number(userId) && row.tutor_id !== Number(userId)) return null;
  return row;
}

/** Details of the other participant, from the caller's point of view. */
export function counterpart(conversation, userId) {
  const isStudent = conversation.student_id === Number(userId);
  return {
    id: isStudent ? conversation.tutor_id : conversation.student_id,
    name: isStudent ? conversation.tutor_name : conversation.student_name,
    role: isStudent ? 'tutor' : 'student',
  };
}

/** Inbox: conversations with a preview and unread count, newest first. */
export function listConversations(userId) {
  return getDb().all(
    `SELECT c.*,
            stu.full_name AS student_name,
            tut.full_name AS tutor_name,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
            (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender_id,
            (SELECT COUNT(*) FROM messages m
              WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread
       FROM conversations c
       JOIN users stu ON stu.id = c.student_id
       JOIN users tut ON tut.id = c.tutor_id
      WHERE c.student_id = ? OR c.tutor_id = ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    [Number(userId), Number(userId), Number(userId)]
  );
}

export function listMessages(conversationId, { afterId = 0, limit = 200 } = {}) {
  return getDb().all(
    `SELECT m.*, u.full_name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.id > ?
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ?`,
    [Number(conversationId), Number(afterId) || 0, Math.min(Math.max(1, limit), 500)]
  );
}

/**
 * Post a message. Validates participation and length here so both the page
 * form and the JSON API get identical rules.
 */
export function sendMessage({ conversationId, senderId, body }) {
  const db = getDb();
  const conversation = getConversationForUser(conversationId, senderId);
  if (!conversation) throw new DomainError('Conversation not found.', { status: 404 });

  const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new DomainError('Write a message before sending.');
  if (text.length > config.limits.messageLength) {
    throw new DomainError(
      `Messages are limited to ${config.limits.messageLength} characters. Yours is ${text.length}.`
    );
  }

  const timestamp = nowIso();
  const sender = findUserById(senderId);
  const other = counterpart(conversation, senderId);

  // Do not let someone write into a void: a suspended account cannot sign in,
  // so a message to them would never be read (QA improvement IMP-4).
  const recipient = findUserById(other.id);
  if (!recipient || recipient.status !== 'active') {
    throw new DomainError(
      'That account is currently unavailable, so the message was not sent. Contact the academic support office if you need help.',
      { status: 409, code: 'recipient_unavailable' }
    );
  }

  const message = db.transaction(() => {
    const { lastInsertRowid } = db.run(
      'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)',
      [conversation.id, Number(senderId), text, timestamp]
    );
    db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [
      timestamp,
      conversation.id,
    ]);
    return db.get('SELECT * FROM messages WHERE id = ?', [lastInsertRowid]);
  });

  notify(other.id, {
    type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
    title: `New message from ${sender.full_name}`,
    body: text.slice(0, 160),
    link: `/messages/${conversation.id}`,
  });

  return message;
}

/** Mark everything the other person sent as read. */
export function markConversationRead(conversationId, userId) {
  return getDb().run(
    `UPDATE messages SET read_at = ?
      WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL`,
    [nowIso(), Number(conversationId), Number(userId)]
  ).changes;
}

export function unreadMessageCount(userId) {
  return Number(
    getDb().value(
      `SELECT COUNT(*) AS c
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.student_id = ? OR c.tutor_id = ?)
          AND m.sender_id <> ?
          AND m.read_at IS NULL`,
      [Number(userId), Number(userId), Number(userId)]
    ) || 0
  );
}

/** Existing conversation for a pair, without creating one. */
export function findConversation(studentId, tutorId) {
  return (
    getDb().get('SELECT * FROM conversations WHERE student_id = ? AND tutor_id = ?', [
      Number(studentId),
      Number(tutorId),
    ]) || null
  );
}

export function countMessages() {
  return Number(getDb().value('SELECT COUNT(*) AS c FROM messages') || 0);
}
