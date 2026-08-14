/**
 * User accounts and role profiles.
 *
 * This is the only module that writes to `users`, `student_profiles` and
 * `tutor_profiles`, so account rules live in exactly one place.
 */
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../lib/security.js';
import { nowIso } from '../lib/time.js';

export const ROLES = Object.freeze(['student', 'tutor', 'admin']);
export const SELF_SERVICE_ROLES = Object.freeze(['student', 'tutor']);

const PUBLIC_COLUMNS =
  'id, email, role, full_name, status, created_at, updated_at, last_login_at';

/** Strip anything that must never leave the server. */
export function publicUser(row) {
  if (!row) return null;
  const { password_hash: _ignored, ...rest } = row;
  return rest;
}

export function findUserById(id) {
  if (!Number.isInteger(Number(id))) return null;
  return getDb().get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [Number(id)]) || null;
}

/** Includes the password hash - only for the login path. */
export function findUserWithSecretByEmail(email) {
  if (typeof email !== 'string' || !email) return null;
  return getDb().get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]) || null;
}

export function findUserByEmail(email) {
  return publicUser(findUserWithSecretByEmail(email));
}

export function emailExists(email) {
  return Boolean(findUserWithSecretByEmail(email));
}

/**
 * Create an account plus its role profile row in one transaction.
 * @param {{email:string, password:string, fullName:string, role:string}} input
 */
export function createUser({ email, password, fullName, role }) {
  const db = getDb();
  const normalisedEmail = String(email).trim().toLowerCase();
  const normalisedRole = String(role);

  if (!ROLES.includes(normalisedRole)) {
    throw new DomainError('That account type is not available.');
  }
  const weak = checkPasswordStrength(password);
  if (weak) throw new DomainError(weak);
  if (emailExists(normalisedEmail)) {
    throw new DomainError('An account with that email address already exists.', {
      status: 409,
      code: 'email_taken',
    });
  }

  const timestamp = nowIso();
  const passwordHash = hashPassword(password);

  return db.transaction(() => {
    const { lastInsertRowid } = db.run(
      `INSERT INTO users (email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [normalisedEmail, passwordHash, normalisedRole, fullName, timestamp, timestamp]
    );

    if (normalisedRole === 'student') {
      db.run('INSERT INTO student_profiles (user_id, updated_at) VALUES (?, ?)', [
        lastInsertRowid,
        timestamp,
      ]);
    } else if (normalisedRole === 'tutor') {
      db.run('INSERT INTO tutor_profiles (user_id, updated_at) VALUES (?, ?)', [
        lastInsertRowid,
        timestamp,
      ]);
    }

    return findUserById(lastInsertRowid);
  });
}

export function updateAccount(userId, { fullName }) {
  const db = getDb();
  db.run('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?', [
    fullName,
    nowIso(),
    Number(userId),
  ]);
  return findUserById(userId);
}

export function recordLogin(userId) {
  getDb().run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), Number(userId)]);
}

/**
 * Change a password after verifying the current one.
 * Callers must revoke other sessions afterwards (see auth.changePassword).
 */
export function updatePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const row = db.get('SELECT id, password_hash FROM users WHERE id = ?', [Number(userId)]);
  if (!row) throw new DomainError('Account not found.', { status: 404 });
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new DomainError('Your current password is incorrect.', { code: 'bad_current_password' });
  }
  const weak = checkPasswordStrength(newPassword);
  if (weak) throw new DomainError(weak, { code: 'weak_password' });
  if (verifyPassword(newPassword, row.password_hash)) {
    throw new DomainError('Your new password must be different from the current one.');
  }
  db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    hashPassword(newPassword),
    nowIso(),
    Number(userId),
  ]);
  return true;
}

export function setUserStatus(userId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw new DomainError('Unknown account status.');
  }
  const db = getDb();
  const user = findUserById(userId);
  if (!user) throw new DomainError('Account not found.', { status: 404 });
  if (user.role === 'admin' && status === 'suspended') {
    throw new DomainError('Administrator accounts cannot be suspended.', { status: 403 });
  }
  db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    nowIso(),
    Number(userId),
  ]);
  return findUserById(userId);
}

/* ---------------------------------------------------- student profiles --- */

export function getStudentProfile(userId) {
  const db = getDb();
  const existing = db.get('SELECT * FROM student_profiles WHERE user_id = ?', [Number(userId)]);
  if (existing) return existing;
  db.run('INSERT INTO student_profiles (user_id, updated_at) VALUES (?, ?)', [
    Number(userId),
    nowIso(),
  ]);
  return db.get('SELECT * FROM student_profiles WHERE user_id = ?', [Number(userId)]);
}

export function saveStudentProfile(userId, { programme, yearOfStudy, bio, goals }) {
  const db = getDb();
  getStudentProfile(userId);
  db.run(
    `UPDATE student_profiles
        SET programme = ?, year_of_study = ?, bio = ?, goals = ?, updated_at = ?
      WHERE user_id = ?`,
    [programme || '', yearOfStudy ?? null, bio || '', goals || '', nowIso(), Number(userId)]
  );
  return getStudentProfile(userId);
}

/**
 * Fraction of the optional student profile that has been filled in - used for
 * the dashboard nudge rather than for gating anything.
 */
export function studentProfileCompleteness(userId) {
  const profile = getStudentProfile(userId);
  const fields = ['programme', 'year_of_study', 'goals'];
  const done = fields.filter((field) => {
    const value = profile[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  }).length;
  return { done, total: fields.length, complete: done === fields.length };
}

/** Directory listing for the admin console. */
export function listUsers({ search = '', role = '', status = '', page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];

  if (search) {
    where.push('(full_name LIKE ? OR email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  if (ROLES.includes(role)) {
    where.push('role = ?');
    params.push(role);
  }
  if (['active', 'suspended'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.value(`SELECT COUNT(*) AS c FROM users ${clause}`, params) || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = db.all(
    `SELECT ${PUBLIC_COLUMNS} FROM users ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (current - 1) * pageSize]
  );

  return { rows, total, page: current, totalPages };
}
