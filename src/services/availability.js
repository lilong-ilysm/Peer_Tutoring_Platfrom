/**
 * Tutor availability and bookable-slot generation.
 *
 * Tutors describe availability once as a recurring weekly pattern; the platform
 * expands it into concrete slots for a rolling window and subtracts everything
 * that makes a slot unbookable (spec business rule 6):
 *   - already in the past, or inside the booking lead time,
 *   - on a date the tutor marked as time off,
 *   - overlapped by a pending or confirmed booking.
 *
 * Students therefore only ever see slots they can actually have (AC-23).
 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { DomainError } from '../lib/errors.js';
import {
  addDaysToDateKey,
  dateKeyOf,
  formatDate,
  intervalsOverlap,
  minutesToTime,
  normaliseDateKey,
  nowIso,
  weekdayOfDateKey,
  zonedWallClockToUtc,
} from '../lib/time.js';

const MAX_BLOCKS_PER_TUTOR = 40;
const MAX_SLOTS = 400;

/* ------------------------------------------------------ weekly pattern --- */

export function listBlocks(tutorId) {
  return getDb().all(
    'SELECT * FROM availability_blocks WHERE tutor_id = ? ORDER BY weekday, start_minute',
    [Number(tutorId)]
  );
}

/** Blocks bucketed by weekday index (0 = Sunday) for the weekly editor. */
export function blocksByWeekday(tutorId) {
  const buckets = [[], [], [], [], [], [], []];
  for (const block of listBlocks(tutorId)) buckets[block.weekday].push(block);
  return buckets;
}

export function hasAvailability(tutorId) {
  return (
    Number(
      getDb().value('SELECT COUNT(*) AS c FROM availability_blocks WHERE tutor_id = ?', [
        Number(tutorId),
      ]) || 0
    ) > 0
  );
}

/**
 * Add a weekly block after checking it is well formed and does not overlap an
 * existing block on the same weekday.
 */
export function addBlock(tutorId, { weekday, startMinute, endMinute }) {
  const db = getDb();
  const day = Number(weekday);
  const start = Number(startMinute);
  const end = Number(endMinute);

  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new DomainError('Choose a valid day of the week.');
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440) {
    throw new DomainError('Enter a valid start and end time.');
  }
  if (end <= start) {
    throw new DomainError('The end time must be after the start time.');
  }
  if (end - start < config.slotMinutes) {
    throw new DomainError(
      `A block must be at least ${config.slotMinutes} minutes long so it fits one session.`
    );
  }

  const existing = db.all(
    'SELECT start_minute, end_minute FROM availability_blocks WHERE tutor_id = ? AND weekday = ?',
    [Number(tutorId), day]
  );
  const clash = existing.find((block) => start < block.end_minute && block.start_minute < end);
  if (clash) {
    throw new DomainError(
      `That overlaps an existing block (${minutesToTime(clash.start_minute)} - ${minutesToTime(
        clash.end_minute
      )}). Remove it first or choose another time.`,
      { status: 409 }
    );
  }
  if (listBlocks(tutorId).length >= MAX_BLOCKS_PER_TUTOR) {
    throw new DomainError(`You can have at most ${MAX_BLOCKS_PER_TUTOR} availability blocks.`);
  }

  const { lastInsertRowid } = db.run(
    `INSERT INTO availability_blocks (tutor_id, weekday, start_minute, end_minute, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [Number(tutorId), day, start, end, nowIso()]
  );
  return db.get('SELECT * FROM availability_blocks WHERE id = ?', [lastInsertRowid]);
}

/** Remove a block. Scoped by tutor_id so one tutor cannot edit another's. */
export function removeBlock(tutorId, blockId) {
  const result = getDb().run('DELETE FROM availability_blocks WHERE id = ? AND tutor_id = ?', [
    Number(blockId),
    Number(tutorId),
  ]);
  if (!result.changes) throw new DomainError('That availability block no longer exists.', { status: 404 });
  return true;
}

/* ------------------------------------------------------------ time off --- */

export function listTimeOff(tutorId, { fromDateKey = dateKeyOf(new Date()) } = {}) {
  return getDb().all(
    'SELECT * FROM tutor_time_off WHERE tutor_id = ? AND date >= ? ORDER BY date',
    [Number(tutorId), fromDateKey]
  );
}

export function addTimeOff(tutorId, { date, note = '' }) {
  const db = getDb();
  const key = normaliseDateKey(date);
  if (!key) throw new DomainError('Choose a valid date.');

  const today = dateKeyOf(new Date());
  if (key < today) throw new DomainError('You cannot mark time off in the past.');
  const horizon = addDaysToDateKey(today, config.bookingWindowDays + 60);
  if (key > horizon) throw new DomainError('That date is too far in the future.');

  const existing = db.get('SELECT id FROM tutor_time_off WHERE tutor_id = ? AND date = ?', [
    Number(tutorId),
    key,
  ]);
  if (existing) throw new DomainError('That date is already marked as time off.', { status: 409 });

  const active = db.all(
    `SELECT id, starts_at FROM bookings
      WHERE tutor_id = ? AND status IN ('pending', 'confirmed')`,
    [Number(tutorId)]
  );
  const clash = active.find((booking) => dateKeyOf(booking.starts_at) === key);
  if (clash) {
    throw new DomainError(
      `You still have a session booked on ${formatDate(
        clash.starts_at
      )}. Cancel or decline it before marking that day as time off.`,
      { status: 409 }
    );
  }

  const { lastInsertRowid } = db.run(
    'INSERT INTO tutor_time_off (tutor_id, date, note, created_at) VALUES (?, ?, ?, ?)',
    [Number(tutorId), key, String(note).slice(0, 160), nowIso()]
  );
  return db.get('SELECT * FROM tutor_time_off WHERE id = ?', [lastInsertRowid]);
}

export function removeTimeOff(tutorId, id) {
  const result = getDb().run('DELETE FROM tutor_time_off WHERE id = ? AND tutor_id = ?', [
    Number(id),
    Number(tutorId),
  ]);
  if (!result.changes) throw new DomainError('That time off entry no longer exists.', { status: 404 });
  return true;
}

/* --------------------------------------------------------------- slots --- */

/** Pending/confirmed bookings that could block a slot. */
export function activeBookingIntervals(tutorId, fromIso = nowIso()) {
  return getDb().all(
    `SELECT starts_at, ends_at FROM bookings
      WHERE tutor_id = ? AND status IN ('pending', 'confirmed') AND ends_at > ?`,
    [Number(tutorId), fromIso]
  );
}

/**
 * Expand the weekly pattern into bookable slots.
 * @param {number} tutorId
 * @param {{now?:Date, days?:number}} [options]
 * @returns {{startsAt:string, endsAt:string, dateKey:string, startMinute:number}[]}
 */
export function generateSlots(tutorId, { now = new Date(), days = config.bookingWindowDays } = {}) {
  const blocks = listBlocks(tutorId);
  if (blocks.length === 0) return [];

  const byWeekday = [[], [], [], [], [], [], []];
  for (const block of blocks) byWeekday[block.weekday].push(block);

  const timeOff = new Set(
    listTimeOff(tutorId, { fromDateKey: dateKeyOf(now) }).map((entry) => entry.date)
  );
  const busy = activeBookingIntervals(tutorId, now.toISOString());
  const leadCutoff = new Date(now.getTime() + config.bookingLeadHours * 3600 * 1000);
  const horizon = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const slotMs = config.slotMinutes * 60 * 1000;
  const startKey = dateKeyOf(now);

  const slots = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const dateKey = addDaysToDateKey(startKey, offset);
    if (timeOff.has(dateKey)) continue;
    const dayBlocks = byWeekday[weekdayOfDateKey(dateKey)];
    if (!dayBlocks.length) continue;

    for (const block of dayBlocks) {
      for (
        let minute = block.start_minute;
        minute + config.slotMinutes <= block.end_minute;
        minute += config.slotMinutes
      ) {
        const start = zonedWallClockToUtc(dateKey, minute, config.timezone);
        if (start < leadCutoff || start > horizon) continue;
        const end = new Date(start.getTime() + slotMs);
        const startsAt = start.toISOString();
        const endsAt = end.toISOString();
        const taken = busy.some((booking) =>
          intervalsOverlap(startsAt, endsAt, booking.starts_at, booking.ends_at)
        );
        if (taken) continue;
        slots.push({ startsAt, endsAt, dateKey, startMinute: minute });
        if (slots.length >= MAX_SLOTS) break;
      }
      if (slots.length >= MAX_SLOTS) break;
    }
    if (slots.length >= MAX_SLOTS) break;
  }

  slots.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return slots;
}

/** Slots grouped for display, one entry per calendar day. */
export function groupSlotsByDay(slots) {
  const days = new Map();
  for (const slot of slots) {
    if (!days.has(slot.dateKey)) days.set(slot.dateKey, { dateKey: slot.dateKey, slots: [] });
    days.get(slot.dateKey).slots.push(slot);
  }
  return [...days.values()];
}

/** Exact-match lookup used when a booking request is submitted. */
export function findSlot(tutorId, startsAt, { now = new Date() } = {}) {
  if (typeof startsAt !== 'string' || !startsAt) return null;
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return generateSlots(tutorId, { now }).find((slot) => slot.startsAt === iso) || null;
}

/** Weekdays (0-6) the tutor has any availability on - used by search filters. */
export function availableWeekdays(tutorId) {
  return getDb()
    .all('SELECT DISTINCT weekday FROM availability_blocks WHERE tutor_id = ? ORDER BY weekday', [
      Number(tutorId),
    ])
    .map((row) => row.weekday);
}
