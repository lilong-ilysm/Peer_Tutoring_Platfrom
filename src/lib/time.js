/**
 * Time helpers.
 *
 * Storage rule: every instant is persisted as an ISO-8601 UTC string
 * (`2026-08-17T07:00:00.000Z`), so lexical ordering equals chronological
 * ordering in SQLite.
 *
 * Display rule: everything a user sees is rendered in the single platform
 * timezone (`config.timezone`) and labelled with it, per spec section 6.
 */
import config from '../config.js';

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MINUTES_IN_DAY = 24 * 60;

const formatterCache = new Map();

function formatter(timeZone, options) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let found = formatterCache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
    formatterCache.set(key, found);
  }
  return found;
}

/** Current instant as an ISO UTC string. */
export function nowIso() {
  return new Date().toISOString();
}

/** Normalise a Date | ISO string | epoch ms into an ISO UTC string. */
export function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date value: ${value}`);
  return date.toISOString();
}

/** True when `value` parses to a real date. */
export function isValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Wall-clock fields of `date` as observed in `timeZone`.
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,
 *   weekday:number,minutes:number,dateKey:string}}
 */
export function zonedParts(date, timeZone = config.timezone) {
  const instant = date instanceof Date ? date : new Date(date);
  const parts = formatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const bag = {};
  for (const part of parts) if (part.type !== 'literal') bag[part.type] = part.value;

  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  const hour = Number(bag.hour) % 24;
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday,
    minutes: hour * 60 + minute,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function timezoneOffsetMinutes(date, timeZone = config.timezone) {
  const instant = date instanceof Date ? date : new Date(date);
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to the matching UTC instant.
 * Handles DST by verifying the offset at the candidate instant.
 *
 * @param {string} dateKey `YYYY-MM-DD` in the target zone
 * @param {number} minutes minutes after local midnight
 */
export function zonedWallClockToUtc(dateKey, minutes, timeZone = config.timezone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) throw new TypeError(`Invalid dateKey: ${dateKey}`);
  const naive = Date.UTC(year, month - 1, day) + minutes * 60000;
  const firstOffset = timezoneOffsetMinutes(new Date(naive), timeZone);
  let instant = naive - firstOffset * 60000;
  const secondOffset = timezoneOffsetMinutes(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) instant = naive - secondOffset * 60000;
  return new Date(instant);
}

/** `YYYY-MM-DD` for an instant, as seen in the platform timezone. */
export function dateKeyOf(date, timeZone = config.timezone) {
  return zonedParts(date, timeZone).dateKey;
}

/** Shift a `YYYY-MM-DD` key by whole days (calendar arithmetic, zone-free). */
export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Weekday index (0 = Sunday) of a `YYYY-MM-DD` key. */
export function weekdayOfDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** `"09:30"` -> 570. Returns null when malformed or out of range. */
export function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  if (total > MINUTES_IN_DAY) return null;
  return total;
}

/** 570 -> `"09:30"`. */
export function minutesToTime(total) {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(total)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** `"2026-08-17"` when the string is a valid calendar date, else null. */
export function normaliseDateKey(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

/** Short zone label for the UI, e.g. `SAST` or `GMT+2`. */
export function timezoneLabel(date = new Date(), timeZone = config.timezone) {
  const parts = formatter(timeZone, { timeZoneName: 'short' }).formatToParts(date);
  const found = parts.find((part) => part.type === 'timeZoneName');
  return found ? found.value : timeZone;
}

/** `Mon 17 Aug 2026` */
export function formatDate(value, timeZone = config.timezone) {
  return formatter(timeZone, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

/** `09:00` */
export function formatTime(value, timeZone = config.timezone) {
  return formatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(value)
  );
}

/** `Mon 17 Aug 2026, 09:00` (optionally with the zone label appended). */
export function formatDateTime(value, { timeZone = config.timezone, withZone = false } = {}) {
  const base = `${formatDate(value, timeZone)}, ${formatTime(value, timeZone)}`;
  return withZone ? `${base} ${timezoneLabel(new Date(value), timeZone)}` : base;
}

/** `09:00 - 10:00` for a slot or booking. */
export function formatTimeRange(startValue, endValue, timeZone = config.timezone) {
  return `${formatTime(startValue, timeZone)} - ${formatTime(endValue, timeZone)}`;
}

/** Human duration such as `1h 30m`. */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

/** Coarse relative time such as `3 minutes ago` / `in 2 days`. */
export function formatRelative(value, from = new Date()) {
  const target = new Date(value).getTime();
  const base = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const diffSeconds = Math.round((target - base) / 1000);
  const past = diffSeconds < 0;
  const seconds = Math.abs(diffSeconds);

  const units = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ];

  if (seconds < 45) return past ? 'just now' : 'in a moment';

  let label = 'year';
  let amount = Math.round(seconds / 31536000);
  for (let i = 0; i < units.length; i += 1) {
    const [name, size] = units[i];
    const next = units[i + 1];
    if (!next || seconds < next[1]) {
      label = name;
      amount = Math.max(1, Math.round(seconds / size));
      break;
    }
  }
  const plural = amount === 1 ? label : `${label}s`;
  return past ? `${amount} ${plural} ago` : `in ${amount} ${plural}`;
}

/** Do intervals [aStart,aEnd) and [bStart,bEnd) overlap? Accepts ISO strings. */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

/** Add minutes to an instant, returning an ISO UTC string. */
export function addMinutesIso(value, minutes) {
  return new Date(new Date(value).getTime() + minutes * 60000).toISOString();
}
