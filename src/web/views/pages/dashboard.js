/**
 * Role-specific dashboards: "what needs me now?".
 */
import config from '../../../config.js';
import { minutesToTime, timezoneLabel, WEEKDAY_SHORT } from '../../../lib/time.js';
import {
  badge,
  csrfField,
  emptyState,
  pageHeader,
  sessionWhen,
  statTile,
  stars,
  submitButton,
} from '../components.js';
import { html, join, raw } from '../html.js';
import { sessionCard } from './bookings.js';
import { tutorCard } from './tutors.js';

export function studentDashboard({
  viewer,
  csrfToken,
  counts,
  nextSession,
  pending,
  awaitingReview,
  unreadMessages,
  completeness,
  suggestions,
}) {
  return html`
    ${pageHeader({
      title: `Hello, ${viewer.full_name.split(' ')[0]}`,
      subtitle: `Here is where your tutoring stands. All times in ${timezoneLabel()}.`,
      actions: html`<a class="btn btn--primary" href="/tutors">Find a tutor</a>`,
    })}

    <div class="grid grid--4 section">
      ${statTile({
        label: 'Upcoming sessions',
        value: counts.upcoming,
        href: '/bookings?scope=upcoming',
        tone: 'success',
      })}
      ${statTile({
        label: 'Awaiting a reply',
        value: counts.pending,
        href: '/bookings?scope=pending',
        tone: 'warning',
      })}
      ${statTile({ label: 'Completed', value: counts.completed, href: '/bookings?scope=past' })}
      ${statTile({
        label: 'Unread messages',
        value: unreadMessages,
        href: '/messages',
        tone: 'info',
      })}
    </div>

    ${completeness.complete
      ? raw('')
      : html`<div class="alert alert--info">
          <span class="alert__label">Finish your profile:</span>
          <span>
            ${completeness.done} of ${completeness.total} details added. Tutors accept requests faster
            when they know your programme and goals.
            <a href="/profile">Update your profile</a>.
          </span>
        </div>`}

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Next session</h2>
        <a class="section__link" href="/bookings">All sessions</a>
      </div>
      ${nextSession
        ? sessionCard(nextSession, { viewer, csrfToken })
        : html`<div class="card">
            ${emptyState({
              icon: 'calendar',
              title: 'No confirmed session yet',
              message:
                'Once a tutor accepts one of your requests it will appear here with the time and place.',
              actionLabel: 'Find a tutor',
              actionHref: '/tutors',
            })}
          </div>`}
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Requests waiting on a tutor</h2>
        <a class="section__link" href="/bookings?scope=pending">See all</a>
      </div>
      ${pending.length === 0
        ? html`<div class="card">
            ${emptyState({
              icon: 'clock',
              title: 'No pending requests',
              message: `You can have up to ${config.maxActiveRequests} requests open at once.`,
            })}
          </div>`
        : join(pending.map((booking) => sessionCard(booking, { viewer, csrfToken })))}
    </section>

    ${awaitingReview.length
      ? html`<section class="section">
          <div class="section__head">
            <h2 class="section__title">Sessions to review</h2>
          </div>
          <div class="card stack">
            <p class="muted text-sm">
              Reviews are how the next student knows who to trust. It takes a few seconds.
            </p>
            ${join(
              awaitingReview.map(
                (booking) => html`<div class="list__item">
                  <div>
                    <strong>${booking.subject_name}</strong> with ${booking.tutor_name}<br />
                    <span class="text-sm muted">${sessionWhen(booking.starts_at, booking.ends_at)}</span>
                  </div>
                  <a class="btn btn--primary btn--sm" href="/bookings/${booking.id}#review"
                    >Leave a review</a
                  >
                </div>`
              )
            )}
          </div>
        </section>`
      : raw('')}

    ${suggestions.length
      ? html`<section class="section">
          <div class="section__head">
            <h2 class="section__title">Tutors you might like</h2>
            <a class="section__link" href="/tutors">Browse all</a>
          </div>
          <div class="tutor-grid">${suggestions.map(tutorCard)}</div>
        </section>`
      : raw('')}
  `;
}

export function tutorDashboard({
  viewer,
  csrfToken,
  counts,
  profile,
  requirements,
  pending,
  upcoming,
  weeklyBlocks,
  unreadMessages,
}) {
  const publishedBadge = profile.is_published
    ? badge('Published', 'success')
    : badge('Not published', 'warning');

  return html`
    ${pageHeader({
      title: `Hello, ${viewer.full_name.split(' ')[0]}`,
      subtitle: `Requests, sessions and your availability. All times in ${timezoneLabel()}.`,
      actions: html`<a class="btn btn--secondary" href="/profile/availability">Manage availability</a>`,
    })}

    <div class="grid grid--4 section">
      ${statTile({
        label: 'Requests to answer',
        value: counts.pending,
        href: '/bookings?scope=pending',
        tone: 'warning',
      })}
      ${statTile({
        label: 'Upcoming sessions',
        value: counts.upcoming,
        href: '/bookings?scope=upcoming',
        tone: 'success',
      })}
      ${statTile({ label: 'Completed', value: counts.completed, href: '/bookings?scope=past' })}
      ${statTile({ label: 'Unread messages', value: unreadMessages, href: '/messages', tone: 'info' })}
    </div>

    <div class="split section">
      <section class="card">
        <div class="card__head">
          <h2 class="card__title">Profile status</h2>
          ${publishedBadge}
        </div>
        <ul class="checklist">
          ${join(
            requirements.checks.map(
              (check) => html`<li>
                <span
                  class="${check.done ? 'checklist__state checklist__state--done' : 'checklist__state checklist__state--todo'}"
                  aria-hidden="true"
                  >${check.done ? '✓' : '•'}</span
                >
                <span>${check.label}${check.done ? '' : ' (still needed)'}</span>
              </li>`
            )
          )}
        </ul>
        <div class="btn-row">
          ${profile.is_published
            ? html`<form method="post" action="/profile/unpublish">
                ${csrfField(csrfToken)}
                ${submitButton('Unpublish profile', { variant: 'secondary' })}
              </form>`
            : html`<form method="post" action="/profile/publish">
                ${csrfField(csrfToken)}
                ${submitButton('Publish profile', { variant: 'primary' })}
              </form>`}
          <a class="btn btn--ghost" href="/profile">Edit profile</a>
        </div>
        ${profile.is_published
          ? html`<p class="text-sm muted">
              Students can find you in search. <a href="/tutors/${viewer.id}">See your public profile</a>.
            </p>`
          : html`<p class="text-sm muted">
              While unpublished you do not appear in search and cannot receive new requests.
            </p>`}
      </section>

      <section class="card">
        <div class="card__head">
          <h2 class="card__title">Your rating</h2>
        </div>
        <p>${stars(profile.rating_avg, profile.rating_count)}</p>
        <h3 class="card__title">Weekly hours</h3>
        ${weeklyBlocks.every((day) => day.length === 0)
          ? html`<p class="muted text-sm">
              No availability yet. <a href="/profile/availability">Add your first block</a>.
            </p>`
          : html`<ul class="stack text-sm">
              ${weeklyBlocks.map((blocks, weekday) =>
                blocks.length
                  ? html`<li>
                      <strong>${WEEKDAY_SHORT[weekday]}</strong>
                      ${blocks
                        .map(
                          (block) =>
                            `${minutesToTime(block.start_minute)}-${minutesToTime(block.end_minute)}`
                        )
                        .join(', ')}
                    </li>`
                  : raw('')
              )}
            </ul>`}
      </section>
    </div>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Requests needing a decision</h2>
        <a class="section__link" href="/bookings?scope=pending">See all</a>
      </div>
      ${pending.length === 0
        ? html`<div class="card">
            ${emptyState({
              icon: 'check',
              title: 'Nothing waiting on you',
              message: 'New requests appear here and in your notifications.',
            })}
          </div>`
        : join(pending.map((booking) => sessionCard(booking, { viewer, csrfToken })))}
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Confirmed sessions</h2>
        <a class="section__link" href="/bookings?scope=upcoming">See all</a>
      </div>
      ${upcoming.length === 0
        ? html`<div class="card">
            ${emptyState({
              icon: 'calendar',
              title: 'No confirmed sessions',
              message: 'Accepted requests show up here with the time and place.',
            })}
          </div>`
        : join(upcoming.map((booking) => sessionCard(booking, { viewer, csrfToken })))}
    </section>
  `;
}

export function adminRedirectNotice() {
  return html`<div class="card">
    <h1>Administrator account</h1>
    <p>Use the <a href="/admin">admin console</a> to manage the platform.</p>
  </div>`;
}
