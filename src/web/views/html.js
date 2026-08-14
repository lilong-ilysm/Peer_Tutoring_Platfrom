/**
 * HTML rendering primitives.
 *
 * The `html` tagged template escapes every interpolated value unless it is
 * explicitly wrapped in `raw()`. That makes cross-site scripting a compile-time
 * decision rather than a per-line discipline: user data is safe by default.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export class Raw {
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }
}

/** Mark a string as already-safe HTML. Use only on markup you produced. */
export function raw(value) {
  return value instanceof Raw ? value : new Raw(value ?? '');
}

/** Escape text for use in element content or a quoted attribute. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function renderValue(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

/** Tagged template producing a `Raw` fragment with all values escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}

/** Join fragments (or plain strings) into one fragment. */
export function join(fragments, separator = '') {
  return new Raw(fragments.map(renderValue).join(separator));
}

/** Build a class attribute value from strings/conditionals. */
export function classNames(...items) {
  return items
    .flat()
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .join(' ');
}

/**
 * Render an attribute map. `false`, `null` and `undefined` drop the attribute;
 * `true` renders it bare (e.g. `required`).
 */
export function attrs(map) {
  const parts = [];
  for (const [key, value] of Object.entries(map || {})) {
    if (value === false || value === null || value === undefined || value === '') continue;
    if (value === true) parts.push(escapeHtml(key));
    else parts.push(`${escapeHtml(key)}="${escapeHtml(value)}"`);
  }
  return new Raw(parts.length ? ` ${parts.join(' ')}` : '');
}

/**
 * Only allow http(s) and site-relative URLs to reach an href, so stored data
 * can never turn into `javascript:` navigation.
 */
export function safeUrl(value, fallback = '') {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    return fallback;
  } catch {
    return fallback;
  }
}

/** Build a query string, dropping empty values. */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Preserve existing filters while overriding some of them (pagination, sort). */
export function withQuery(currentQuery, overrides) {
  const merged = { ...currentQuery, ...overrides };
  return queryString(merged);
}
