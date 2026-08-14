/**
 * Subject catalogue.
 *
 * The catalogue is admin-curated on purpose: free-text subjects would make
 * search meaningless (spec section 2.1).
 */
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';

export function listSubjects({ activeOnly = true } = {}) {
  const db = getDb();
  return activeOnly
    ? db.all('SELECT * FROM subjects WHERE is_active = 1 ORDER BY category, name')
    : db.all('SELECT * FROM subjects ORDER BY category, name');
}

export function getSubject(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return null;
  return getDb().get('SELECT * FROM subjects WHERE id = ?', [numeric]) || null;
}

export function getActiveSubject(id) {
  const subject = getSubject(id);
  return subject && subject.is_active ? subject : null;
}

export function createSubject({ code, name, category }) {
  const db = getDb();
  const normalisedCode = String(code).trim().toUpperCase();
  const normalisedName = String(name).trim();

  const clash = db.get('SELECT id FROM subjects WHERE code = ? OR name = ?', [
    normalisedCode,
    normalisedName,
  ]);
  if (clash) {
    throw new DomainError('A subject with that code or name already exists.', { status: 409 });
  }

  const { lastInsertRowid } = db.run(
    'INSERT INTO subjects (code, name, category, is_active) VALUES (?, ?, ?, 1)',
    [normalisedCode, normalisedName, String(category || 'General').trim() || 'General']
  );
  return getSubject(lastInsertRowid);
}

export function updateSubject(id, { name, category }) {
  const db = getDb();
  const subject = getSubject(id);
  if (!subject) throw new DomainError('Subject not found.', { status: 404 });

  const normalisedName = String(name).trim();
  const clash = db.get('SELECT id FROM subjects WHERE name = ? AND id <> ?', [
    normalisedName,
    subject.id,
  ]);
  if (clash) throw new DomainError('Another subject already uses that name.', { status: 409 });

  db.run('UPDATE subjects SET name = ?, category = ? WHERE id = ?', [
    normalisedName,
    String(category || 'General').trim() || 'General',
    subject.id,
  ]);
  return getSubject(subject.id);
}

/**
 * Retiring a subject hides it from new selections but keeps historic bookings
 * intact (the FK is RESTRICT, so nothing is silently deleted).
 */
export function setSubjectActive(id, isActive) {
  const db = getDb();
  const subject = getSubject(id);
  if (!subject) throw new DomainError('Subject not found.', { status: 404 });
  db.run('UPDATE subjects SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, subject.id]);
  return getSubject(subject.id);
}

/** Catalogue plus how many published tutors teach each subject. */
export function subjectsWithTutorCounts({ activeOnly = true } = {}) {
  const db = getDb();
  const clause = activeOnly ? 'WHERE s.is_active = 1' : '';
  return db.all(`
    SELECT s.*,
           (SELECT COUNT(*)
              FROM tutor_subjects ts
              JOIN tutor_profiles tp ON tp.user_id = ts.tutor_id
              JOIN users u ON u.id = ts.tutor_id
             WHERE ts.subject_id = s.id AND tp.is_published = 1 AND u.status = 'active') AS tutor_count
      FROM subjects s
      ${clause}
     ORDER BY s.category, s.name
  `);
}

export function subjectOptions(subjects) {
  return subjects.map((subject) => ({
    value: subject.id,
    label: `${subject.name} (${subject.code})`,
  }));
}
