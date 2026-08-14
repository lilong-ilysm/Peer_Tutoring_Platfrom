/**
 * Shared UI components.
 *
 * Every form control renders a real <label>, wires errors through
 * aria-describedby/aria-invalid, and keeps the submitted value so a rejected
 * form never wipes what the user typed (spec section 5.4).
 */
import config from '../../config.js';
import { avatarBucket } from '../../lib/security.js';
import {
  formatDate,
  formatDateTime,
  formatRelative,
  formatTime,
  timezoneLabel,
  WEEKDAY_NAMES,
} from '../../lib/time.js';
import { attrs, classNames, escapeHtml, html, join, raw, safeUrl } from './html.js';

/* ------------------------------------------------------------- feedback -- */

export function alert(flash) {
  if (!flash || !flash.message) return raw('');
  const type = ['success', 'error', 'warning', 'info'].includes(flash.type) ? flash.type : 'info';
  const label = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Notice' }[type];
  return html`
    <div class="alert alert--${type}" role="${type === 'error' ? 'alert' : 'status'}">
      <span class="alert__label">${label}:</span>
      <span>${flash.message}</span>
    </div>
  `;
}

export function errorSummary(errors) {
  const entries = Object.entries(errors || {});
  if (!entries.length) return raw('');
  return html`
    <div class="alert alert--error" role="alert">
      <span class="alert__label">Please fix the following:</span>
      <ul class="alert__list">
        ${entries.map(([field, message]) => html`<li><a href="#${field}">${message}</a></li>`)}
      </ul>
    </div>
  `;
}

export function emptyState({ title, message, actionLabel, actionHref, icon = 'inbox' }) {
  return html`
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">${icons[icon] || icons.inbox}</div>
      <h3 class="empty__title">${title}</h3>
      <p class="empty__message">${message}</p>
      ${actionHref
        ? html`<a class="btn btn--primary" href="${safeUrl(actionHref, '/')}">${actionLabel}</a>`
        : raw('')}
    </div>
  `;
}

/* ---------------------------------------------------------------- forms -- */

export function csrfField(csrfToken) {
  return html`<input type="hidden" name="_csrf" value="${csrfToken}" />`;
}

function describedBy(name, { help, error }) {
  const ids = [];
  if (help) ids.push(`${name}-help`);
  if (error) ids.push(`${name}-error`);
  return ids.length ? ids.join(' ') : undefined;
}

function fieldShell(name, label, { help, error, required, control, hint }) {
  return html`
    <div class="${classNames('field', error && 'field--invalid')}">
      <label class="field__label" for="${name}">
        ${label}${required ? html`<span class="field__required" aria-hidden="true">*</span>` : raw('')}
      </label>
      ${help ? html`<p class="field__help" id="${name}-help">${help}</p>` : raw('')}
      ${control}
      ${hint ? html`<p class="field__hint">${hint}</p>` : raw('')}
      ${error ? html`<p class="field__error" id="${name}-error">${error}</p>` : raw('')}
    </div>
  `;
}

export function textField({
  name,
  label,
  value = '',
  type = 'text',
  error = '',
  help = '',
  hint = '',
  required = false,
  autocomplete,
  maxlength,
  min,
  max,
  step,
  placeholder,
  inputmode,
  readonly = false,
}) {
  const control = html`<input
    class="input"
    id="${name}"
    name="${name}"
    type="${type}"
    value="${value ?? ''}"
    ${attrs({
      required: required || undefined,
      autocomplete,
      maxlength,
      min,
      max,
      step,
      placeholder,
      inputmode,
      readonly: readonly || undefined,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy(name, { help, error }),
    })}
  />`;
  return fieldShell(name, label, { help, error, required, control, hint });
}

export function textareaField({
  name,
  label,
  value = '',
  error = '',
  help = '',
  hint = '',
  required = false,
  rows = 5,
  maxlength = 1000,
  placeholder,
}) {
  const control = html`<textarea
    class="input input--textarea"
    id="${name}"
    name="${name}"
    rows="${rows}"
    maxlength="${maxlength}"
    data-counter="true"
    ${attrs({
      required: required || undefined,
      placeholder,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy(name, { help, error }),
    })}
  >${value ?? ''}</textarea>`;
  return fieldShell(name, label, { help, error, required, control, hint });
}

export function selectField({
  name,
  label,
  value = '',
  options = [],
  error = '',
  help = '',
  hint = '',
  required = false,
  placeholder = '',
}) {
  const control = html`<select
    class="input input--select"
    id="${name}"
    name="${name}"
    ${attrs({
      required: required || undefined,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy(name, { help, error }),
    })}
  >
    ${placeholder ? html`<option value="">${placeholder}</option>` : raw('')}
    ${options.map(
      (option) => html`<option
        value="${option.value}"
        ${attrs({ selected: String(option.value) === String(value ?? '') || undefined })}
      >
        ${option.label}
      </option>`
    )}
  </select>`;
  return fieldShell(name, label, { help, error, required, control, hint });
}

export function checkboxField({ name, label, checked = false, help = '', value = 'on' }) {
  return html`
    <div class="field field--checkbox">
      <input
        class="checkbox"
        type="checkbox"
        id="${name}"
        name="${name}"
        value="${value}"
        ${attrs({
          checked: checked || undefined,
          'aria-describedby': help ? `${name}-help` : undefined,
        })}
      />
      <label class="checkbox__label" for="${name}">${label}</label>
      ${help ? html`<p class="field__help" id="${name}-help">${help}</p>` : raw('')}
    </div>
  `;
}

export function submitButton(label, { variant = 'primary', name, value, className = '' } = {}) {
  return html`<button
    class="${classNames('btn', `btn--${variant}`, className)}"
    type="submit"
    data-submit-once="true"
    ${attrs({ name, value })}
  >
    ${label}
  </button>`;
}

/* ---------------------------------------------------------------- atoms -- */

export function avatar(name, { size = 'md', id = '' } = {}) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
  const bucket = avatarBucket(`${id}|${name}`);
  return html`<span
    class="avatar avatar--${size} avatar--c${bucket}"
    aria-hidden="true"
    title="${name || ''}"
    >${initials || '?'}</span
  >`;
}

const STATUS_META = {
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  completed: { label: 'Completed', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status, tone: 'neutral' };
  return html`<span class="badge badge--${meta.tone}">${meta.label}</span>`;
}

export function badge(label, tone = 'neutral') {
  return html`<span class="badge badge--${tone}">${label}</span>`;
}

export const LEVEL_LABELS = {
  intro: 'Introductory',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const MODE_LABELS = {
  online: 'Online',
  in_person: 'In person',
  both: 'Online or in person',
};

/**
 * Star rating.
 *
 * `compact` renders one individual rating (a single review) without a review
 * count, because "5.0 (1 review)" beside every review reads as if each review
 * has its own tally.
 */
export function stars(average, count, { compact = false } = {}) {
  const value = Number(average) || 0;
  const rounded = Math.round(value * 2) / 2;
  const glyphs = [];
  for (let i = 1; i <= 5; i += 1) {
    if (rounded >= i) glyphs.push('★');
    else if (rounded >= i - 0.5) glyphs.push('◐');
    else glyphs.push('☆');
  }

  if (compact) {
    return html`<span class="rating">
      <span class="rating__stars" aria-hidden="true">${glyphs.join('')}</span>
      <span class="rating__text">${value.toFixed(1)}</span>
      <span class="sr-only">Rated ${value.toFixed(1)} out of 5</span>
    </span>`;
  }

  if (!count) {
    return html`<span class="rating rating--none">
      <span class="rating__stars" aria-hidden="true">☆☆☆☆☆</span>
      <span class="rating__text">No reviews yet</span>
    </span>`;
  }
  return html`<span class="rating">
    <span class="rating__stars" aria-hidden="true">${glyphs.join('')}</span>
    <span class="rating__text">${value.toFixed(1)}</span>
    <span class="rating__count">(${count} ${count === 1 ? 'review' : 'reviews'})</span>
    <span class="sr-only">Rated ${value.toFixed(1)} out of 5 from ${count} reviews</span>
  </span>`;
}

/** Machine-readable time that client JS may re-render as relative. */
export function timeTag(iso, { relative = false, withZone = false } = {}) {
  if (!iso) return raw('');
  const absolute = formatDateTime(iso, { withZone });
  return html`<time
    datetime="${iso}"
    ${attrs({ 'data-relative': relative ? 'true' : undefined, title: absolute })}
    >${relative ? formatRelative(iso) : absolute}</time
  >`;
}

export function dateTag(iso) {
  if (!iso) return raw('');
  return html`<time datetime="${iso}">${formatDate(iso)}</time>`;
}

export function money(cents) {
  if (cents === null || cents === undefined) return raw('');
  const amount = Number(cents) / 100;
  if (!amount) return html`<span class="price price--free">Free</span>`;
  return html`<span class="price">${config.currencySymbol}${amount.toFixed(2)}<span class="price__unit">/hour</span></span>`;
}

export function sessionWhen(startsAt, endsAt) {
  return html`<span class="when">
    <time datetime="${startsAt}">${formatDate(startsAt)}</time>
    <span class="when__time">${formatTime(startsAt)} - ${formatTime(endsAt)}</span>
    <span class="when__zone">${timezoneLabel()}</span>
  </span>`;
}

export function weekdayName(index) {
  return WEEKDAY_NAMES[index] || '';
}

/* ------------------------------------------------------------ structure -- */

/**
 * What a displayed rate actually means.
 *
 * Rates are advertised by tutors, but no money moves through the platform, so
 * this appears wherever a rate is shown to stop anyone assuming they will be
 * charged here (audit finding 7).
 */
export function paymentNote({ compact = false } = {}) {
  const text = `Rates are advertised by tutors for reference only. ${config.appName} does not process payments — students and tutors arrange any payment directly between themselves.`;
  return compact
    ? html`<p class="note note--compact">${text}</p>`
    : html`<p class="note">${text}</p>`;
}

export function pageHeader({ title, subtitle, actions }) {
  return html`
    <div class="page-header">
      <div class="page-header__text">
        <h1 class="page-header__title">${title}</h1>
        ${subtitle ? html`<p class="page-header__subtitle">${subtitle}</p>` : raw('')}
      </div>
      ${actions ? html`<div class="page-header__actions">${actions}</div>` : raw('')}
    </div>
  `;
}

export function card(body, { className = '', as = 'div' } = {}) {
  const tag = escapeHtml(as);
  return raw(`<${tag} class="${escapeHtml(classNames('card', className))}">${raw(body)}</${tag}>`);
}

export function statTile({ label, value, href, hint, tone = 'neutral' }) {
  const inner = html`
    <span class="stat__value">${value}</span>
    <span class="stat__label">${label}</span>
    ${hint ? html`<span class="stat__hint">${hint}</span>` : raw('')}
  `;
  if (href) {
    return html`<a class="stat stat--${tone} stat--link" href="${safeUrl(href, '/')}">${inner}</a>`;
  }
  return html`<div class="stat stat--${tone}">${inner}</div>`;
}

export function pagination({ page, totalPages, buildHref, label = 'Results' }) {
  if (totalPages <= 1) return raw('');
  const items = [];
  const first = Math.max(1, page - 2);
  const last = Math.min(totalPages, first + 4);
  for (let index = first; index <= last; index += 1) {
    items.push(
      index === page
        ? html`<span class="pagination__page pagination__page--current" aria-current="page">${index}</span>`
        : html`<a class="pagination__page" href="${buildHref(index)}">${index}</a>`
    );
  }
  return html`
    <nav class="pagination" aria-label="${label} pages">
      ${page > 1
        ? html`<a class="pagination__step" href="${buildHref(page - 1)}" rel="prev">Previous</a>`
        : html`<span class="pagination__step pagination__step--disabled">Previous</span>`}
      <span class="pagination__pages">${join(items)}</span>
      ${page < totalPages
        ? html`<a class="pagination__step" href="${buildHref(page + 1)}" rel="next">Next</a>`
        : html`<span class="pagination__step pagination__step--disabled">Next</span>`}
    </nav>
  `;
}

/**
 * Filter tabs.
 *
 * These are links that navigate, not ARIA tabs (there is no tabpanel), so they
 * are marked up as navigation with `aria-current` instead of `role="tab"`.
 */
export function tabs(items, { label = 'Filter' } = {}) {
  return html`
    <nav class="tabs" aria-label="${label}">
      ${items.map(
        (item) => html`<a
          class="${classNames('tab', item.active && 'tab--active')}"
          href="${safeUrl(item.href, '/')}"
          ${attrs({ 'aria-current': item.active ? 'page' : undefined })}
          >${item.label}${item.count !== undefined
            ? html` <span class="tab__count">${item.count}</span>`
            : raw('')}</a
        >`
      )}
    </nav>
  `;
}

/* ---------------------------------------------------------------- icons -- */

export const icons = {
  inbox: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12h4l2 3h6l2-3h4"/><path d="M5 5h14l2 7v7H3v-7z"/></svg>'
  ),
  search: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
  ),
  calendar: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'
  ),
  chat: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6.5A8 8 0 0 1 12 4h1a8 8 0 0 1 8 8z"/></svg>'
  ),
  bell: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/></svg>'
  ),
  star: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4l2.5 5 5.5.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.5-.8z"/></svg>'
  ),
  users: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.5a3.5 3.5 0 0 1 0 7M18 20a6.4 6.4 0 0 0-2-4.6"/></svg>'
  ),
  clock: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>'
  ),
  check: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 13l4 4L19 7"/></svg>'
  ),
  home: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/></svg>'
  ),
  user: raw(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>'
  ),
};
