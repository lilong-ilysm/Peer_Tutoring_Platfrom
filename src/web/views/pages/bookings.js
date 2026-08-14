/**
 * Session list, session detail and the review form.
 *
 * Actions are rendered only when the viewer may actually perform them, and the
 * server re-checks every one (the UI is a hint, not the authority).
 */
import config from '../../../config.js';
import { formatDateTime, timezoneLabel } from '../../../lib/time.js';
import {
  avatar,
  badge,
  csrfField,
  emptyState,
  MODE_LABELS,
  pageHeader,
  pagination,
  selectField,
  sessionWhen,
  statusBadge,
  submitButton,
  tabs,
  textareaField,
  timeTag,
} from '../components.js';
import { html, join, queryString, raw, safeUrl } from '../html.js';

const ACTIVE = new Set(['pending', 'confirmed']);

function counterpartOf(booking, viewer) {
  const isTutor = viewer.id === booking.tutor_id;
  return {
    name: isTutor ? booking.student_name : booking.tutor_name,
    id: isTutor ? booking.student_id : booking.tutor_id,
    role: isTutor ? 'student' : 'tutor',
  };
}

function cancelForm(booking, csrfToken, { compact = false } = {}) {
  return html`
    <details class="reason-form">
      <summary>Cancel this session</summary>
      <form method="post" action="/bookings/${booking.id}/cancel">
        ${csrfField(csrfToken)}
        ${textareaField({
          name: 'reason',
          label: 'Reason',
          rows: compact ? 2 : 3,
          maxlength: config.limits.noteLength,
          required: true,
          help: 'The other person sees this, so a short honest note is enough.',
        })}
        ${submitButton('Confirm cancellation', { variant: 'danger' })}
      </form>
    </details>
  `;
}

function declineForm(booking, csrfToken) {
  return html`
    <details class="reason-form">
      <summary>Decline this request</summary>
      <form method="post" action="/bookings/${booking.id}/decline">
        ${csrfField(csrfToken)}
        ${textareaField({
          name: 'note',
          label: 'Reason (optional)',
          rows: 2,
          maxlength: config.limits.noteLength,
          help: 'Helpful when the student could simply pick another time.',
        })}
        ${submitButton('Confirm decline', { variant: 'danger' })}
      </form>
    </details>
  `;
}

/** One session in a list. */
export function sessionCard(booking, { viewer, csrfToken, showActions = true }) {
  const other = counterpartOf(booking, viewer);
  const isTutor = viewer.id === booking.tutor_id;
  const isParticipant = isTutor || viewer.id === booking.student_id;
  const canAct = ACTIVE.has(booking.status);
  // Non-participants (administrators) get the information, never the controls.
  const withActions = showActions && isParticipant;

  return html`
    <article class="session">
      <div>
        <h3 class="session__title">
          <a href="/bookings/${booking.id}">${booking.subject_name}</a>
          <span class="muted">with ${other.name}</span>
        </h3>
        <div class="session__meta">
          ${sessionWhen(booking.starts_at, booking.ends_at)} ${statusBadge(booking.status)}
          ${badge(MODE_LABELS[booking.mode] || booking.mode, 'neutral')}
        </div>
        ${booking.status === 'declined' && booking.tutor_note
          ? html`<p class="text-sm muted">Reason: ${booking.tutor_note}</p>`
          : raw('')}
        ${booking.status === 'cancelled' && booking.cancel_reason
          ? html`<p class="text-sm muted">Reason: ${booking.cancel_reason}</p>`
          : raw('')}
      </div>

      ${withActions
        ? html`<div class="session__actions">
            ${isTutor && booking.status === 'pending'
              ? html`<form method="post" action="/bookings/${booking.id}/accept">
                    ${csrfField(csrfToken)} ${submitButton('Accept', { variant: 'primary' })}
                  </form>
                  ${declineForm(booking, csrfToken)}`
              : raw('')}
            ${!isTutor && booking.status === 'completed' && !booking.review_id
              ? html`<a class="btn btn--primary btn--sm" href="/bookings/${booking.id}#review"
                  >Leave a review</a
                >`
              : raw('')}
            <a class="btn btn--secondary btn--sm" href="/bookings/${booking.id}"
              >${canAct ? 'Details and cancel' : 'Details'}</a
            >
          </div>`
        : raw('')}
    </article>
  `;
}

/** Sessions page with status tabs. */
export function bookingsPage({ viewer, scope, results, csrfToken, counts }) {
  const buildHref = (page) => `/bookings${queryString({ scope, page })}`;

  const emptyCopy = {
    upcoming: {
      title: 'Nothing scheduled',
      message:
        viewer.role === 'student'
          ? 'Find a tutor and request a time that works for you.'
          : 'When students request sessions they will appear here.',
      actionLabel: viewer.role === 'student' ? 'Find a tutor' : 'Manage availability',
      actionHref: viewer.role === 'student' ? '/tutors' : '/profile/availability',
    },
    pending: {
      title: 'No requests waiting',
      message:
        viewer.role === 'student'
          ? 'Requests you send appear here until the tutor responds.'
          : 'You are all caught up - no requests need a decision.',
    },
    past: {
      title: 'No past sessions yet',
      message: 'Completed, declined and cancelled sessions are kept here for your records.',
    },
    all: {
      title: 'No sessions yet',
      message: 'Every session you take part in is listed here.',
    },
  }[scope];

  return html`
    ${pageHeader({
      title: 'Sessions',
      subtitle: `All times in ${timezoneLabel()}. Sessions are ${config.slotMinutes} minutes long.`,
      actions:
        viewer.role === 'student'
          ? html`<a class="btn btn--primary" href="/tutors">Find a tutor</a>`
          : html`<a class="btn btn--secondary" href="/profile/availability">Manage availability</a>`,
    })}

    ${tabs(
      [
        { label: 'Upcoming', href: '/bookings?scope=upcoming', active: scope === 'upcoming', count: counts.upcoming },
        { label: 'Pending', href: '/bookings?scope=pending', active: scope === 'pending', count: counts.pending },
        { label: 'Past', href: '/bookings?scope=past', active: scope === 'past' },
        { label: 'All', href: '/bookings?scope=all', active: scope === 'all', count: counts.total },
      ],
      { label: 'Filter sessions' }
    )}

    ${results.rows.length === 0
      ? html`<div class="card">${emptyState({ icon: 'calendar', ...emptyCopy })}</div>`
      : join(results.rows.map((booking) => sessionCard(booking, { viewer, csrfToken })))}

    ${pagination({ page: results.page, totalPages: results.totalPages, buildHref, label: 'Sessions' })}
  `;
}

/** Full detail view, including the review form when eligible. */
export function bookingDetailPage({ booking, viewer, csrfToken, timeline, review, conversationId }) {
  const other = counterpartOf(booking, viewer);
  const isTutor = viewer.id === booking.tutor_id;
  const isStudent = viewer.id === booking.student_id;
  const isParticipant = isTutor || isStudent;
  const canReview = isStudent && booking.status === 'completed' && !review;

  return html`
    ${pageHeader({
      title: isParticipant
        ? `${booking.subject_name} with ${other.name}`
        : `${booking.subject_name}: ${booking.student_name} with ${booking.tutor_name}`,
      subtitle: formatDateTime(booking.starts_at, { withZone: true }),
      actions: html`<a class="btn btn--ghost" href="/bookings">Back to sessions</a>`,
    })}

    <div class="split">
      <div class="stack">
        <section class="card">
          <div class="card__head">
            <h2 class="card__title">Session</h2>
            ${statusBadge(booking.status)}
          </div>
          <dl class="definition">
            <dt>When</dt>
            <dd>${sessionWhen(booking.starts_at, booking.ends_at)}</dd>
            <dt>Subject</dt>
            <dd>${booking.subject_name} (${booking.subject_code})</dd>
            <dt>Mode</dt>
            <dd>${MODE_LABELS[booking.mode] || booking.mode}</dd>
            <dt>${booking.mode === 'online' ? 'Meeting link' : 'Where'}</dt>
            <dd>
              ${booking.status === 'confirmed' && booking.location
                ? booking.mode === 'online'
                  ? html`<a href="${safeUrl(booking.location, '#')}" rel="noopener noreferrer" target="_blank"
                      >${booking.location}</a
                    >`
                  : html`${booking.location}`
                : booking.location && booking.mode === 'in_person'
                  ? html`${booking.location}`
                  : html`<span class="muted">Shared once the session is confirmed</span>`}
            </dd>
            <dt>Student</dt>
            <dd>${booking.student_name}</dd>
            <dt>Tutor</dt>
            <dd><a href="/tutors/${booking.tutor_id}">${booking.tutor_name}</a></dd>
          </dl>

          ${booking.student_note
            ? html`<h3>What the student asked for</h3>
                <p>${booking.student_note}</p>`
            : raw('')}
          ${booking.tutor_note
            ? html`<h3>Tutor note</h3>
                <p>${booking.tutor_note}</p>`
            : raw('')}
          ${booking.cancel_reason
            ? html`<h3>Cancellation reason</h3>
                <p>${booking.cancel_reason}</p>`
            : raw('')}

          <div class="btn-row">
            ${isTutor && booking.status === 'pending'
              ? html`<form method="post" action="/bookings/${booking.id}/accept">
                  ${csrfField(csrfToken)} ${submitButton('Accept request')}
                </form>`
              : raw('')}
            ${conversationId
              ? html`<a class="btn btn--secondary" href="/messages/${conversationId}"
                  >Message ${other.name.split(' ')[0]}</a
                >`
              : isStudent
                ? html`<form method="post" action="/messages/start">
                    ${csrfField(csrfToken)}
                    <input type="hidden" name="tutorId" value="${booking.tutor_id}" />
                    ${submitButton(`Message ${other.name.split(' ')[0]}`, { variant: 'secondary' })}
                  </form>`
                : raw('')}
          </div>

          ${isTutor && booking.status === 'pending' ? declineForm(booking, csrfToken) : raw('')}
          ${isParticipant && ACTIVE.has(booking.status) ? cancelForm(booking, csrfToken) : raw('')}
          ${isParticipant
            ? raw('')
            : html`<p class="alert alert--info" role="status">
                <span class="alert__label">Read-only:</span>
                <span>
                  You are viewing this session as an administrator. Only the student and the tutor can
                  accept, decline or cancel it.
                </span>
              </p>`}
        </section>

        ${canReview
          ? html`<section class="card" id="review">
              <h2 class="card__title">Review this session</h2>
              <p class="muted text-sm">
                Your review is public on ${booking.tutor_name}'s profile and helps other students
                choose. You can only review a session once.
              </p>
              <form class="form" method="post" action="/bookings/${booking.id}/review">
                ${csrfField(csrfToken)}
                ${selectField({
                  name: 'rating',
                  label: 'Rating',
                  required: true,
                  placeholder: 'Choose a rating',
                  options: [
                    { value: '5', label: '5 - Excellent' },
                    { value: '4', label: '4 - Good' },
                    { value: '3', label: '3 - Okay' },
                    { value: '2', label: '2 - Poor' },
                    { value: '1', label: '1 - Very poor' },
                  ],
                })}
                ${textareaField({
                  name: 'comment',
                  label: 'Comment',
                  rows: 4,
                  maxlength: config.limits.reviewLength,
                  help: 'Optional. What went well, what could be better?',
                })}
                ${submitButton('Submit review')}
              </form>
            </section>`
          : raw('')}
        ${review
          ? html`<section class="card" id="review">
              <h2 class="card__title">Review</h2>
              <p class="chips">
                ${badge(`${review.rating} of 5`, 'brand')}
                ${timeTag(review.created_at, { relative: true })}
              </p>
              <p>${review.comment || 'No comment left.'}</p>
              ${review.is_hidden
                ? html`<p class="text-sm muted">
                    This review is hidden by a moderator and does not affect the tutor's rating.
                  </p>`
                : raw('')}
            </section>`
          : raw('')}
      </div>

      <aside class="stack">
        <section class="card">
          <h2 class="card__title">Activity</h2>
          <ol class="timeline">
            ${join(
              timeline.map(
                (event) => html`<li class="timeline__item">
                  <span class="timeline__label">${event.label}</span>
                  <span class="timeline__time">${timeTag(event.at)}</span>
                  ${event.detail ? html`<p class="text-sm muted">${event.detail}</p>` : raw('')}
                </li>`
              )
            )}
          </ol>
        </section>

        <section class="card">
          <h2 class="card__title">
            ${isParticipant
              ? other.role === 'tutor'
                ? 'Your tutor'
                : 'Your student'
              : other.role === 'tutor'
                ? 'Tutor'
                : 'Student'}
          </h2>
          <p class="chips">${avatar(other.name, { size: 'md', id: other.id })} ${other.name}</p>
          ${other.role === 'tutor'
            ? html`<a class="btn btn--secondary btn--block" href="/tutors/${other.id}">View profile</a>`
            : raw('')}
        </section>
      </aside>
    </div>
  `;
}
