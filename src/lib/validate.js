/**
 * Input validation.
 *
 * One validator used by both page handlers and the JSON API so a rule is
 * written once. Collects field-level errors instead of throwing on the first
 * problem, because forms must be able to show every mistake at once and must
 * never lose what the user typed.
 */
import { ValidationError } from './errors.js';
import { normaliseDateKey, parseTimeToMinutes } from './time.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export class Validator {
  /** @param {Record<string, unknown>} source parsed request body or query */
  constructor(source = {}) {
    this.source = source || {};
    /** @type {Record<string,string>} */
    this.errors = {};
  }

  raw(field) {
    const value = this.source[field];
    if (Array.isArray(value)) return value.length ? value[value.length - 1] : '';
    return value;
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return undefined;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  /** Throw a ValidationError when anything failed. */
  assert() {
    if (!this.ok) throw new ValidationError(this.errors);
  }

  /**
   * Trimmed single-line string.
   * @param {string} field
   * @param {{label?:string, required?:boolean, min?:number, max?:number,
   *   default?:string, pattern?:RegExp, patternMessage?:string}} [options]
   */
  string(field, options = {}) {
    const {
      label = humanise(field),
      required = false,
      min = 0,
      max = 255,
      pattern,
      patternMessage,
    } = options;
    const raw = this.raw(field);
    const value = raw === undefined || raw === null ? '' : String(raw).trim().replace(/\s+/g, ' ');

    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return options.default ?? '';
    }
    if (value.length < min) return this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) return this.fail(field, `${label} must be ${max} characters or fewer.`);
    if (pattern && !pattern.test(value)) {
      return this.fail(field, patternMessage || `${label} is not in the expected format.`);
    }
    return value;
  }

  /** Multi-line text: trimmed, newlines preserved, CRLF normalised. */
  text(field, options = {}) {
    const { label = humanise(field), required = false, min = 0, max = 2000 } = options;
    const raw = this.raw(field);
    const value =
      raw === undefined || raw === null ? '' : String(raw).replace(/\r\n/g, '\n').trim();

    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return options.default ?? '';
    }
    if (value.length < min) return this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) return this.fail(field, `${label} must be ${max} characters or fewer.`);
    return value;
  }

  /** Lower-cased email address. */
  email(field, options = {}) {
    const { label = humanise(field), required = false } = options;
    const raw = this.raw(field);
    const value = raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return '';
    }
    if (value.length > 254) return this.fail(field, `${label} is too long.`);
    if (!EMAIL_RE.test(value)) return this.fail(field, `Enter a valid ${label.toLowerCase()}.`);
    return value;
  }

  /** Raw password - never trimmed, never normalised. */
  password(field, options = {}) {
    const { label = humanise(field), required = true } = options;
    const raw = this.raw(field);
    const value = raw === undefined || raw === null ? '' : String(raw);
    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return '';
    }
    return value;
  }

  /** Integer with optional bounds. */
  int(field, options = {}) {
    const {
      label = humanise(field),
      required = false,
      min = Number.MIN_SAFE_INTEGER,
      max = Number.MAX_SAFE_INTEGER,
    } = options;
    const raw = this.raw(field);
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) {
      if (required) return this.fail(field, `${label} is required.`);
      return options.default ?? null;
    }
    if (!/^-?\d+$/.test(text)) return this.fail(field, `${label} must be a whole number.`);
    const value = Number.parseInt(text, 10);
    if (!Number.isSafeInteger(value)) return this.fail(field, `${label} is out of range.`);
    if (value < min) return this.fail(field, `${label} must be ${min} or more.`);
    if (value > max) return this.fail(field, `${label} must be ${max} or less.`);
    return value;
  }

  /** Money amount in major units -> integer cents. */
  money(field, options = {}) {
    const { label = humanise(field), required = false, max = 100000 } = options;
    const raw = this.raw(field);
    const text = raw === undefined || raw === null ? '' : String(raw).trim().replace(/,/g, '');
    if (!text) {
      if (required) return this.fail(field, `${label} is required.`);
      return options.default ?? null;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return this.fail(field, `${label} must be an amount such as 120 or 120.50.`);
    }
    const value = Math.round(Number.parseFloat(text) * 100);
    if (value > max * 100) return this.fail(field, `${label} must be ${max} or less.`);
    return value;
  }

  /** Value restricted to a fixed set. */
  enum(field, allowed, options = {}) {
    const { label = humanise(field), required = false } = options;
    const raw = this.raw(field);
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return options.default ?? null;
    }
    if (!allowed.includes(value)) return this.fail(field, `Choose a valid ${label.toLowerCase()}.`);
    return value;
  }

  /** Checkbox semantics: present and truthy -> true. */
  bool(field) {
    const raw = this.raw(field);
    if (raw === undefined || raw === null) return false;
    const value = String(raw).toLowerCase();
    return value === 'on' || value === 'true' || value === '1' || value === 'yes';
  }

  /** http(s) URL only, so a stored link can never be `javascript:`. */
  url(field, options = {}) {
    const { label = humanise(field), required = false, max = 500 } = options;
    const raw = this.raw(field);
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!value) {
      if (required) return this.fail(field, `${label} is required.`);
      return '';
    }
    if (value.length > max) return this.fail(field, `${label} must be ${max} characters or fewer.`);
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return this.fail(field, `${label} must be a full URL starting with https://`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return this.fail(field, `${label} must start with http:// or https://`);
    }
    return parsed.toString();
  }

  /** `YYYY-MM-DD` calendar date. */
  dateKey(field, options = {}) {
    const { label = humanise(field), required = false } = options;
    const raw = this.raw(field);
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) {
      if (required) return this.fail(field, `${label} is required.`);
      return null;
    }
    const value = normaliseDateKey(text);
    if (!value) return this.fail(field, `${label} must be a valid date.`);
    return value;
  }

  /** `HH:MM` clock time -> minutes after midnight. */
  timeMinutes(field, options = {}) {
    const { label = humanise(field), required = false } = options;
    const raw = this.raw(field);
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) {
      if (required) return this.fail(field, `${label} is required.`);
      return null;
    }
    const value = parseTimeToMinutes(text);
    if (value === null) return this.fail(field, `${label} must be a time such as 09:30.`);
    return value;
  }

  /** ISO-8601 instant -> normalised ISO UTC string. */
  isoDateTime(field, options = {}) {
    const { label = humanise(field), required = false } = options;
    const raw = this.raw(field);
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) {
      if (required) return this.fail(field, `${label} is required.`);
      return null;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return this.fail(field, `${label} must be a valid date/time.`);
    return date.toISOString();
  }
}

function humanise(field) {
  return field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------------------------------------------------------------------------
 * Query-string coercion helpers.
 *
 * Search filters must never error on junk input (AC-21): unusable values are
 * ignored or clamped rather than rejected.
 * ------------------------------------------------------------------------- */

export function coerceInt(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null || String(text).trim() === '') return fallback;
  const parsed = Number.parseInt(String(text).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function coerceFloat(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null || String(text).trim() === '') return fallback;
  const parsed = Number.parseFloat(String(text).trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function coerceEnum(value, allowed, fallback = null) {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null) return fallback;
  const trimmed = String(text).trim();
  return allowed.includes(trimmed) ? trimmed : fallback;
}

export function coerceString(value, { max = 120, fallback = '' } = {}) {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null) return fallback;
  return String(text).trim().replace(/\s+/g, ' ').slice(0, max);
}
