/**
 * Authentication: registration, login and server-side sessions.
 *
 * Session design (spec section 6):
 *  - the cookie holds a 256-bit opaque random token,
 *  - only its SHA-256 digest is stored, so a stolen database dump cannot be
 *    replayed as a live session,
 *  - each session carries its own CSRF token,
 *  - expiry slides on use, and every session can be revoked instantly
 *    (password change, suspension, logout).
 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { randomToken, sha256, verifyPassword } from '../lib/security.js';
import { nowIso } from '../lib/time.js';
import { createUser, findUserById, findUserWithSecretByEmail, recordLogin, updatePassword } from './users.js';

export const SESSION_COOKIE = 'pl_session';

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

function expiryFrom(date = new Date()) {
  return new Date(date.getTime() + config.sessionTtlHours * 3600 * 1000).toISOString();
}

/** Create a session row and return the raw token for the cookie. */
export function createSession(userId, { ip = '', userAgent = '' } = {}) {
  const db = getDb();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const timestamp = nowIso();

  db.run(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sha256(token),
      Number(userId),
      csrfToken,
      timestamp,
      timestamp,
      expiryFrom(),
      String(ip).slice(0, 60),
      String(userAgent).slice(0, 200),
    ]
  );

  return { token, csrfToken, expiresAt: expiryFrom() };
}

/**
 * Resolve a cookie value to its session and user.
 * Returns null for unknown, expired or suspended-owner sessions, cleaning up
 * as it goes so stale rows do not accumulate.
 */
export function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const db = getDb();
  const hash = sha256(token);
  const session = db.get('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
  if (!session) return null;

  if (session.expires_at <= nowIso()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', [hash]);
    return null;
  }

  const user = findUserById(session.user_id);
  if (!user || user.status !== 'active') {
    db.run('DELETE FROM sessions WHERE token_hash = ?', [hash]);
    return null;
  }

  // Slide the expiry once the session is past the halfway mark.
  const created = new Date(session.last_seen_at).getTime();
  if (Date.now() - created > (config.sessionTtlHours * 3600 * 1000) / 2) {
    db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?', [
      nowIso(),
      expiryFrom(),
      hash,
    ]);
  }

  return { session, user };
}

export function destroySession(token) {
  if (typeof token !== 'string' || !token) return;
  getDb().run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export function destroyAllSessionsForUser(userId, { exceptToken } = {}) {
  const db = getDb();
  if (exceptToken) {
    db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [
      Number(userId),
      sha256(exceptToken),
    ]);
  } else {
    db.run('DELETE FROM sessions WHERE user_id = ?', [Number(userId)]);
  }
}

export function purgeExpiredSessions() {
  return getDb().run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]).changes;
}

export function countSessionsForUser(userId) {
  return Number(
    getDb().value('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?', [Number(userId)]) || 0
  );
}

/** Register an account and immediately sign it in. */
export function register({ email, password, fullName, role, ip, userAgent }) {
  const user = createUser({ email, password, fullName, role });
  const session = createSession(user.id, { ip, userAgent });
  recordLogin(user.id);
  return { user, ...session };
}

/**
 * Verify credentials and start a session.
 * Unknown email and wrong password produce the same error, and both paths do
 * comparable work, so accounts cannot be enumerated (AC-4).
 */
export function login({ email, password, ip, userAgent }) {
  const row = findUserWithSecretByEmail(email);
  if (!row) {
    // Burn comparable CPU so timing does not reveal whether the email exists.
    verifyPassword(
      String(password || ''),
      'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
    );
    throw new DomainError(GENERIC_LOGIN_ERROR, { status: 401, code: 'invalid_credentials' });
  }
  if (!verifyPassword(String(password || ''), row.password_hash)) {
    throw new DomainError(GENERIC_LOGIN_ERROR, { status: 401, code: 'invalid_credentials' });
  }
  if (row.status !== 'active') {
    throw new DomainError(
      'This account has been suspended. Contact the academic support office for help.',
      { status: 403, code: 'account_suspended' }
    );
  }

  const session = createSession(row.id, { ip, userAgent });
  recordLogin(row.id);
  return { user: findUserById(row.id), ...session };
}

/** Change a password and revoke every other session for that user. */
export function changePassword(userId, currentPassword, newPassword, { keepToken } = {}) {
  updatePassword(userId, currentPassword, newPassword);
  destroyAllSessionsForUser(userId, { exceptToken: keepToken });
  return true;
}

/** Suspending an account must also cut off any live sessions (AC-7). */
export function revokeSessionsOnSuspension(userId) {
  destroyAllSessionsForUser(userId);
}
