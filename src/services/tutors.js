/**
 * Tutor profiles, taught subjects, publication gate and tutor search.
 *
 * The publication gate (business rule 5) is the reason search results are
 * trustworthy: a tutor is only discoverable once they have a headline, at least
 * one subject and at least one availability block, so no student can land on a
 * profile they cannot book.
 */
import config from '../config.js';
import { getDb, likePattern } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { hasAvailability } from './availability.js';
import { getActiveSubject } from './subjects.js';

export const TUTOR_MODES = Object.freeze(['online', 'in_person', 'both']);
export const SUBJECT_LEVELS = Object.freeze(['intro', 'intermediate', 'advanced']);
export const SORT_OPTIONS = Object.freeze(['rating', 'rate_asc', 'rate_desc', 'newest', 'name']);
const MAX_SUBJECTS_PER_TUTOR = 12;

/* -------------------------------------------------------------- profile --- */

/** Fetch (creating on first use) the tutor profile row. */
export function getTutorProfile(tutorId) {
  const db = getDb();
  const existing = db.get('SELECT * FROM tutor_profiles WHERE user_id = ?', [Number(tutorId)]);
  if (existing) return existing;
  db.run('INSERT INTO tutor_profiles (user_id, updated_at) VALUES (?, ?)', [
    Number(tutorId),
    nowIso(),
  ]);
  return db.get('SELECT * FROM tutor_profiles WHERE user_id = ?', [Number(tutorId)]);
}

export function saveTutorProfile(
  tutorId,
  { headline, bio, mode, campus, meetingLink, hourlyRateCents, yearsExperience }
) {
  const db = getDb();
  getTutorProfile(tutorId);

  if (!TUTOR_MODES.includes(mode)) throw new DomainError('Choose a valid session mode.');
  if (mode !== 'online' && !String(campus || '').trim()) {
    throw new DomainError('Tell students where you meet on campus for in-person sessions.');
  }
  if (mode !== 'in_person' && !String(meetingLink || '').trim()) {
    throw new DomainError('Add a meeting link so online sessions have somewhere to happen.');
  }

  db.run(
    `UPDATE tutor_profiles
        SET headline = ?, bio = ?, mode = ?, campus = ?, meeting_link = ?,
            hourly_rate_cents = ?, years_experience = ?, updated_at = ?
      WHERE user_id = ?`,
    [
      headline || '',
      bio || '',
      mode,
      campus || '',
      meetingLink || '',
      Number(hourlyRateCents) || 0,
      Number(yearsExperience) || 0,
      nowIso(),
      Number(tutorId),
    ]
  );

  // Keep the search index honest: if the profile no longer qualifies, unpublish.
  const requirements = publishRequirements(tutorId);
  if (!requirements.ok) {
    db.run('UPDATE tutor_profiles SET is_published = 0 WHERE user_id = ?', [Number(tutorId)]);
  }
  return getTutorProfile(tutorId);
}

/* ------------------------------------------------------------- subjects --- */

export function listTutorSubjects(tutorId) {
  return getDb().all(
    `SELECT ts.subject_id, ts.level, s.name, s.code, s.category, s.is_active
       FROM tutor_subjects ts
       JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.tutor_id = ?
      ORDER BY s.name`,
    [Number(tutorId)]
  );
}

export function teachesSubject(tutorId, subjectId) {
  return Boolean(
    getDb().get('SELECT 1 AS ok FROM tutor_subjects WHERE tutor_id = ? AND subject_id = ?', [
      Number(tutorId),
      Number(subjectId),
    ])
  );
}

export function addTutorSubject(tutorId, subjectId, level) {
  const db = getDb();
  if (!SUBJECT_LEVELS.includes(level)) throw new DomainError('Choose a valid level.');
  const subject = getActiveSubject(subjectId);
  if (!subject) throw new DomainError('That subject is not available.', { status: 404 });
  if (teachesSubject(tutorId, subject.id)) {
    throw new DomainError(`${subject.name} is already on your list.`, { status: 409 });
  }
  if (listTutorSubjects(tutorId).length >= MAX_SUBJECTS_PER_TUTOR) {
    throw new DomainError(
      `You can teach at most ${MAX_SUBJECTS_PER_TUTOR} subjects. Remove one first.`
    );
  }
  db.run(
    'INSERT INTO tutor_subjects (tutor_id, subject_id, level, created_at) VALUES (?, ?, ?, ?)',
    [Number(tutorId), subject.id, level, nowIso()]
  );
  return subject;
}

export function removeTutorSubject(tutorId, subjectId) {
  const db = getDb();
  const result = db.run('DELETE FROM tutor_subjects WHERE tutor_id = ? AND subject_id = ?', [
    Number(tutorId),
    Number(subjectId),
  ]);
  if (!result.changes) throw new DomainError('That subject is not on your list.', { status: 404 });
  if (!publishRequirements(tutorId).ok) {
    db.run('UPDATE tutor_profiles SET is_published = 0 WHERE user_id = ?', [Number(tutorId)]);
  }
  return true;
}

/* -------------------------------------------------- publication gate ----- */

/**
 * What a tutor still needs before their profile can go live.
 * @returns {{ok:boolean, checks:{key:string,label:string,done:boolean}[], missing:string[]}}
 */
export function publishRequirements(tutorId) {
  const profile = getTutorProfile(tutorId);
  const checks = [
    {
      key: 'headline',
      label: 'Add a headline so students know what you offer',
      done: String(profile.headline || '').trim().length > 0,
    },
    {
      key: 'contact',
      label: 'Say where you meet: a campus location, a meeting link, or both',
      done:
        (profile.mode === 'online' && String(profile.meeting_link || '').trim().length > 0) ||
        (profile.mode === 'in_person' && String(profile.campus || '').trim().length > 0) ||
        (profile.mode === 'both' &&
          String(profile.meeting_link || '').trim().length > 0 &&
          String(profile.campus || '').trim().length > 0),
    },
    {
      key: 'subjects',
      label: 'Choose at least one subject you can tutor',
      done: listTutorSubjects(tutorId).length > 0,
    },
    {
      key: 'availability',
      label: 'Add at least one weekly availability block',
      done: hasAvailability(tutorId),
    },
  ];
  return {
    ok: checks.every((check) => check.done),
    checks,
    missing: checks.filter((check) => !check.done).map((check) => check.label),
  };
}

export function setPublished(tutorId, publish) {
  const db = getDb();
  if (publish) {
    const requirements = publishRequirements(tutorId);
    if (!requirements.ok) {
      throw new DomainError(
        `Your profile is not ready to publish yet: ${requirements.missing[0].toLowerCase()}.`
      );
    }
  }
  db.run('UPDATE tutor_profiles SET is_published = ?, updated_at = ? WHERE user_id = ?', [
    publish ? 1 : 0,
    nowIso(),
    Number(tutorId),
  ]);
  return getTutorProfile(tutorId);
}

/* --------------------------------------------------------------- search --- */

const BASE_VISIBILITY = `
  tp.is_published = 1
  AND u.status = 'active'
  AND EXISTS (SELECT 1 FROM tutor_subjects ts WHERE ts.tutor_id = u.id)
  AND EXISTS (SELECT 1 FROM availability_blocks ab WHERE ab.tutor_id = u.id)
`;

/**
 * The single projection behind every tutor card, wherever it is rendered
 * (search results, landing page, dashboard suggestions).
 *
 * This exists because it did not: the landing page used a shorter SELECT that
 * omitted `bio`, so the same tutor showed a description on /tutors and
 * "No description added yet." on the homepage. One component, one query shape.
 */
const CARD_COLUMNS = `
  u.id, u.full_name, u.created_at,
  tp.headline, tp.bio, tp.mode, tp.campus,
  tp.hourly_rate_cents, tp.years_experience, tp.rating_avg, tp.rating_count
`;

/**
 * Search published tutors.
 *
 * Every filter is optional and every value is bound as a parameter. Junk input
 * is coerced by the caller (see lib/validate coerce helpers), so a malformed
 * query can only ever mean "filter not applied" (AC-21).
 */
export function searchTutors({
  q = '',
  subjectId = null,
  level = null,
  mode = null,
  minRating = null,
  maxRateCents = null,
  weekday = null,
  sort = 'rating',
  page = 1,
  pageSize = config.limits.pageSize,
} = {}) {
  const db = getDb();
  const where = [BASE_VISIBILITY];
  const params = [];

  if (q) {
    // ESCAPE '\' plus likePattern() means % and _ typed by the user are matched
    // literally instead of behaving as wildcards.
    where.push(`(
      u.full_name LIKE ? ESCAPE '\\' OR tp.headline LIKE ? ESCAPE '\\' OR tp.bio LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM tutor_subjects ts2
          JOIN subjects s2 ON s2.id = ts2.subject_id
         WHERE ts2.tutor_id = u.id
           AND (s2.name LIKE ? ESCAPE '\\' OR s2.code LIKE ? ESCAPE '\\')
      )
    )`);
    const like = likePattern(q);
    params.push(like, like, like, like, like);
  }

  if (subjectId) {
    if (level && SUBJECT_LEVELS.includes(level)) {
      where.push(
        'EXISTS (SELECT 1 FROM tutor_subjects ts3 WHERE ts3.tutor_id = u.id AND ts3.subject_id = ? AND ts3.level = ?)'
      );
      params.push(Number(subjectId), level);
    } else {
      where.push(
        'EXISTS (SELECT 1 FROM tutor_subjects ts3 WHERE ts3.tutor_id = u.id AND ts3.subject_id = ?)'
      );
      params.push(Number(subjectId));
    }
  } else if (level && SUBJECT_LEVELS.includes(level)) {
    where.push('EXISTS (SELECT 1 FROM tutor_subjects ts3 WHERE ts3.tutor_id = u.id AND ts3.level = ?)');
    params.push(level);
  }

  if (mode === 'online' || mode === 'in_person') {
    where.push("(tp.mode = ? OR tp.mode = 'both')");
    params.push(mode);
  }

  if (minRating !== null && minRating !== undefined) {
    where.push('tp.rating_avg >= ?');
    params.push(Number(minRating));
  }

  if (maxRateCents !== null && maxRateCents !== undefined) {
    where.push('tp.hourly_rate_cents <= ?');
    params.push(Number(maxRateCents));
  }

  if (weekday !== null && weekday !== undefined) {
    where.push(
      'EXISTS (SELECT 1 FROM availability_blocks ab2 WHERE ab2.tutor_id = u.id AND ab2.weekday = ?)'
    );
    params.push(Number(weekday));
  }

  const orderBy = {
    rating: 'tp.rating_avg DESC, tp.rating_count DESC, u.full_name ASC',
    rate_asc: 'tp.hourly_rate_cents ASC, tp.rating_avg DESC',
    rate_desc: 'tp.hourly_rate_cents DESC, tp.rating_avg DESC',
    newest: 'u.created_at DESC',
    name: 'u.full_name ASC',
  }[SORT_OPTIONS.includes(sort) ? sort : 'rating'];

  const clause = `WHERE ${where.join(' AND ')}`;
  const total = Number(
    db.value(
      `SELECT COUNT(*) AS c FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id ${clause}`,
      params
    ) || 0
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const rows = db.all(
    `SELECT ${CARD_COLUMNS}
       FROM tutor_profiles tp
       JOIN users u ON u.id = tp.user_id
       ${clause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, (current - 1) * pageSize]
  );

  return {
    rows: attachSubjects(rows),
    total,
    page: current,
    totalPages,
    pageSize,
  };
}

/** One extra query for all rows instead of one per row (no N+1). */
function attachSubjects(rows) {
  if (!rows.length) return rows;
  const db = getDb();
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const subjectRows = db.all(
    `SELECT ts.tutor_id, ts.level, s.id AS subject_id, s.name, s.code
       FROM tutor_subjects ts
       JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.tutor_id IN (${placeholders})
      ORDER BY s.name`,
    ids
  );
  const grouped = new Map();
  for (const row of subjectRows) {
    if (!grouped.has(row.tutor_id)) grouped.set(row.tutor_id, []);
    grouped.get(row.tutor_id).push(row);
  }
  return rows.map((row) => ({ ...row, subjects: grouped.get(row.id) || [] }));
}

/** Publicly visible tutor, or null when not published / not a tutor. */
export function getPublicTutor(tutorId) {
  const db = getDb();
  const row = db.get(
    `SELECT u.id, u.full_name, u.created_at, u.role, u.status,
            tp.headline, tp.bio, tp.mode, tp.campus, tp.meeting_link,
            tp.hourly_rate_cents, tp.years_experience, tp.is_published,
            tp.rating_avg, tp.rating_count
       FROM users u
       JOIN tutor_profiles tp ON tp.user_id = u.id
      WHERE u.id = ? AND u.role = 'tutor'`,
    [Number(tutorId)]
  );
  if (!row) return null;
  return { ...row, subjects: listTutorSubjects(tutorId) };
}

/** Highest-rated published tutors for the landing page. */
export function featuredTutors(limit = 3) {
  const db = getDb();
  const rows = db.all(
    `SELECT ${CARD_COLUMNS}
       FROM tutor_profiles tp
       JOIN users u ON u.id = tp.user_id
      WHERE ${BASE_VISIBILITY}
      ORDER BY tp.rating_count DESC, tp.rating_avg DESC, u.created_at DESC
      LIMIT ?`,
    [Math.min(Math.max(1, limit), 12)]
  );
  return attachSubjects(rows);
}

export function countPublishedTutors() {
  return Number(
    getDb().value(
      `SELECT COUNT(*) AS c FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE ${BASE_VISIBILITY}`
    ) || 0
  );
}
