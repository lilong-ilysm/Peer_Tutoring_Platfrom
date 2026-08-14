/**
 * Tutor discovery: search results, public profile and the booking request form.
 */
import config from '../../../config.js';
import {
  formatDate,
  formatTime,
  minutesToTime,
  timezoneLabel,
  WEEKDAY_NAMES,
} from '../../../lib/time.js';
import {
  avatar,
  badge,
  csrfField,
  emptyState,
  LEVEL_LABELS,
  MODE_LABELS,
  money,
  pageHeader,
  pagination,
  selectField,
  stars,
  statusBadge,
  submitButton,
  textareaField,
  textField,
  timeTag,
} from '../components.js';
import { html, join, queryString, raw, safeUrl } from '../html.js';

const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((name, index) => ({ value: index, label: name }));

/** Compact tutor summary used in search results and on the landing page. */
export function tutorCard(tutor) {
  return html`
    <article class="tutor-card">
      <div class="tutor-card__head">
        ${avatar(tutor.full_name, { size: 'md', id: tutor.id })}
        <div>
          <h3 class="tutor-card__name">
            <a href="/tutors/${tutor.id}">${tutor.full_name}</a>
          </h3>
          <p class="tutor-card__headline clamp-2">${tutor.headline || 'Peer tutor'}</p>
        </div>
      </div>

      <div class="chips">
        ${(tutor.subjects || [])
          .slice(0, 3)
          .map((subject) => badge(`${subject.name} · ${LEVEL_LABELS[subject.level]}`, 'brand'))}
        ${(tutor.subjects || []).length > 3
          ? badge(`+${tutor.subjects.length - 3} more`, 'neutral')
          : raw('')}
      </div>

      <p class="text-sm muted clamp-3">${tutor.bio || 'No description added yet.'}</p>

      <div class="tutor-card__meta">
        ${stars(tutor.rating_avg, tutor.rating_count)}
        <span class="chips">
          ${badge(MODE_LABELS[tutor.mode] || tutor.mode, 'neutral')} ${money(tutor.hourly_rate_cents)}
        </span>
      </div>

      <a class="btn btn--secondary btn--block" href="/tutors/${tutor.id}">View profile</a>
    </article>
  `;
}

/**
 * Search page. Filters live in the query string, so results are shareable and
 * the back button behaves (AC-20).
 */
export function tutorSearchPage({ filters, results, subjects, query }) {
  const buildHref = (page) => `/tutors${queryString({ ...query, page })}`;
  const hasFilters = Boolean(
    filters.q ||
      filters.subjectId ||
      filters.level ||
      filters.mode ||
      filters.minRating ||
      filters.maxRate ||
      filters.weekday !== null
  );

  return html`
    ${pageHeader({
      title: 'Find a tutor',
      subtitle: `${results.total} ${results.total === 1 ? 'tutor is' : 'tutors are'} published and taking bookings. All times shown in ${timezoneLabel()}.`,
    })}

    <div class="search-layout">
      <form class="filters" method="get" action="/tutors" data-autosubmit>
        <h2 class="sr-only">Filter tutors</h2>

        ${textField({
          name: 'q',
          label: 'Search',
          value: filters.q,
          placeholder: 'Name, subject or keyword',
          help: 'Matches names, headlines, descriptions and subjects.',
          maxlength: 80,
        })}

        <div class="filters__group">
          ${selectField({
            name: 'subject',
            label: 'Subject',
            value: filters.subjectId || '',
            placeholder: 'Any subject',
            options: subjects.map((subject) => ({
              value: subject.id,
              label: `${subject.name} (${subject.tutor_count ?? 0})`,
            })),
          })}
          ${selectField({
            name: 'level',
            label: 'Level',
            value: filters.level || '',
            placeholder: 'Any level',
            options: Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label })),
          })}
        </div>

        <div class="filters__group">
          ${selectField({
            name: 'mode',
            label: 'Session mode',
            value: filters.mode || '',
            placeholder: 'Online or in person',
            options: [
              { value: 'online', label: 'Online' },
              { value: 'in_person', label: 'In person' },
            ],
          })}
          ${selectField({
            name: 'day',
            label: 'Available on',
            value: filters.weekday === null ? '' : String(filters.weekday),
            placeholder: 'Any day',
            options: WEEKDAY_OPTIONS,
          })}
        </div>

        <div class="filters__group">
          ${selectField({
            name: 'rating',
            label: 'Minimum rating',
            value: filters.minRating || '',
            placeholder: 'Any rating',
            options: [
              { value: '4.5', label: '4.5+ stars' },
              { value: '4', label: '4+ stars' },
              { value: '3', label: '3+ stars' },
            ],
          })}
          ${textField({
            name: 'maxRate',
            label: `Max rate (${config.currencySymbol} per hour)`,
            value: filters.maxRate ?? '',
            type: 'number',
            min: 0,
            step: '1',
            inputmode: 'numeric',
            help: 'Leave empty for any rate. Free tutors always match.',
          })}
        </div>

        ${selectField({
          name: 'sort',
          label: 'Sort by',
          value: filters.sort,
          options: [
            { value: 'rating', label: 'Highest rated' },
            { value: 'rate_asc', label: 'Lowest rate' },
            { value: 'rate_desc', label: 'Highest rate' },
            { value: 'newest', label: 'Newest tutors' },
            { value: 'name', label: 'Name (A-Z)' },
          ],
        })}

        <div class="btn-row">
          ${submitButton('Apply filters', { variant: 'primary' })}
          ${hasFilters ? html`<a class="btn btn--ghost btn--sm" href="/tutors">Clear all</a>` : raw('')}
        </div>
      </form>

      <section aria-label="Search results">
        <div class="results__head">
          <p class="results__count">
            ${results.total === 0
              ? 'No tutors match your filters'
              : html`Showing <strong>${results.rows.length}</strong> of
                  <strong>${results.total}</strong> tutors`}
          </p>
        </div>

        ${results.rows.length === 0
          ? emptyState({
              icon: 'search',
              title: 'No tutors match those filters',
              message: hasFilters
                ? 'Try removing a filter, widening the rating range, or searching a different subject.'
                : 'No tutors have published a profile yet. Check back soon, or sign up as a tutor yourself.',
              actionLabel: hasFilters ? 'Clear filters' : 'Become a tutor',
              actionHref: hasFilters ? '/tutors' : '/register?role=tutor',
            })
          : html`<div class="tutor-grid">${results.rows.map(tutorCard)}</div>`}

        ${pagination({
          page: results.page,
          totalPages: results.totalPages,
          buildHref,
          label: 'Tutor results',
        })}
      </section>
    </div>
  `;
}

/** Public tutor profile with live availability and reviews. */
export function tutorProfilePage({
  tutor,
  slotDays,
  reviews,
  viewer,
  canBook,
  weeklyBlocks,
  csrfToken,
}) {
  const bookingIntro = () => {
    if (canBook) {
      return html`<p class="muted text-sm">
        Pick a time to send a request. ${tutor.full_name.split(' ')[0]} confirms it before the session
        is booked. Times are shown in ${timezoneLabel()} and need at least
        ${config.bookingLeadHours} hours' notice.
      </p>`;
    }
    if (!viewer) {
      return html`<p class="muted text-sm">
        <a href="/login?next=${encodeURIComponent(`/tutors/${tutor.id}`)}">Sign in as a student</a> to
        request one of these times.
      </p>`;
    }
    if (viewer.id === tutor.id) {
      return html`<p class="muted text-sm">
        This is how students see your availability.
        <a href="/profile/availability">Manage your availability</a>.
      </p>`;
    }
    return html`<p class="muted text-sm">
      Only student accounts can request sessions, so these times are read-only for you.
    </p>`;
  };

  return html`
    <div class="stack">
      <div class="card">
        <div class="profile-head">
          ${avatar(tutor.full_name, { size: 'lg', id: tutor.id })}
          <div class="profile-head__text">
            <h1 class="profile-head__name">${tutor.full_name}</h1>
            <p class="muted">${tutor.headline || 'Peer tutor'}</p>
            <div class="chips">
              ${stars(tutor.rating_avg, tutor.rating_count)}
              ${badge(MODE_LABELS[tutor.mode] || tutor.mode, 'neutral')}
              ${tutor.years_experience
                ? badge(
                    `${tutor.years_experience} ${tutor.years_experience === 1 ? 'year' : 'years'} tutoring`,
                    'neutral'
                  )
                : raw('')}
              ${money(tutor.hourly_rate_cents)}
            </div>
          </div>
          <div class="btn-row">
            <a class="btn btn--primary" href="#availability">See availability</a>
            ${viewer && viewer.role === 'student'
              ? html`<form method="post" action="/messages/start">
                  ${csrfField(csrfToken)}
                  <input type="hidden" name="tutorId" value="${tutor.id}" />
                  ${submitButton('Message', { variant: 'secondary' })}
                </form>`
              : raw('')}
          </div>
        </div>
      </div>

      <div class="split">
        <div class="stack">
          <section class="card">
            <h2 class="card__title">About</h2>
            <p>${tutor.bio || 'This tutor has not added a description yet.'}</p>
            <dl class="definition">
              ${tutor.mode !== 'online'
                ? html`<dt>Meets on campus</dt>
                    <dd>${tutor.campus || 'Location shared once confirmed'}</dd>`
                : raw('')}
              ${tutor.mode !== 'in_person'
                ? html`<dt>Online sessions</dt>
                    <dd>Meeting link shared with the confirmed session</dd>`
                : raw('')}
              <dt>Session length</dt>
              <dd>${config.slotMinutes} minutes</dd>
            </dl>
          </section>

          <section class="card" id="availability">
            <h2 class="card__title">Availability</h2>
            ${bookingIntro()}
            ${slotDays.length === 0
              ? emptyState({
                  icon: 'calendar',
                  title: 'No open times right now',
                  message:
                    'Every slot in the next few weeks is either booked or outside this tutor’s hours. Message them or check back later.',
                })
              : join(
                  slotDays.map(
                    (day) => html`
                      <div class="slot-day">
                        <p class="slot-day__label">${formatDate(day.slots[0].startsAt)}</p>
                        <div class="slot-list">
                          ${day.slots.map((slot) =>
                            canBook
                              ? html`<a
                                  class="slot"
                                  href="/bookings/new?tutor=${tutor.id}&slot=${encodeURIComponent(
                                    slot.startsAt
                                  )}"
                                  >${formatTime(slot.startsAt)}</a
                                >`
                              : html`<span class="slot">${formatTime(slot.startsAt)}</span>`
                          )}
                        </div>
                      </div>
                    `
                  )
                )}
          </section>

          <section class="card" id="reviews">
            <h2 class="card__title">Reviews</h2>
            ${reviews.length === 0
              ? emptyState({
                  icon: 'star',
                  title: 'No reviews yet',
                  message: 'Reviews appear here once students have completed sessions with this tutor.',
                })
              : join(
                  reviews.map(
                    (review) => html`
                      <article class="review">
                        <div class="review__head">
                          <span class="review__author">
                            ${avatar(review.student_name, { size: 'sm', id: review.student_id })}
                            ${review.student_name}
                          </span>
                          <span class="chips">
                            ${stars(review.rating, 1, { compact: true })}
                            ${timeTag(review.created_at, { relative: true })}
                          </span>
                        </div>
                        <p class="review__comment">${review.comment || 'No comment left.'}</p>
                        <p class="text-sm muted">${review.subject_name}</p>
                      </article>
                    `
                  )
                )}
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <h2 class="card__title">Subjects</h2>
            ${tutor.subjects.length === 0
              ? html`<p class="muted text-sm">No subjects listed yet.</p>`
              : html`<ul class="stack">
                  ${tutor.subjects.map(
                    (subject) => html`<li>
                      <strong>${subject.name}</strong>
                      <span class="text-sm muted">${subject.code}</span><br />
                      ${badge(LEVEL_LABELS[subject.level], 'brand')}
                    </li>`
                  )}
                </ul>`}
          </section>

          <section class="card">
            <h2 class="card__title">Weekly hours</h2>
            ${weeklyBlocks.every((day) => day.length === 0)
              ? html`<p class="muted text-sm">No weekly hours published.</p>`
              : html`<dl class="definition">
                  ${weeklyBlocks.map((blocks, weekday) =>
                    blocks.length
                      ? html`<dt>${WEEKDAY_NAMES[weekday]}</dt>
                          <dd>
                            ${blocks
                              .map(
                                (block) =>
                                  `${minutesToTime(block.start_minute)} - ${minutesToTime(block.end_minute)}`
                              )
                              .join(', ')}
                          </dd>`
                      : raw('')
                  )}
                </dl>`}
            <p class="text-sm muted">Times in ${timezoneLabel()}.</p>
          </section>
        </div>
      </div>
    </div>
  `;
}

/** Confirmation step: choose subject, mode and note before requesting. */
export function bookingRequestPage({ tutor, slot, subjectOptions, values, errors, csrfToken }) {
  return html`
    ${pageHeader({
      title: 'Request a session',
      subtitle: `With ${tutor.full_name}. The tutor still needs to accept before it is confirmed.`,
    })}

    <div class="split">
      <form class="card form" method="post" action="/bookings">
        ${csrfField(csrfToken)}
        <input type="hidden" name="tutorId" value="${tutor.id}" />
        <input type="hidden" name="startsAt" value="${slot.startsAt}" />

        ${selectField({
          name: 'subjectId',
          label: 'Subject',
          value: values.subjectId || '',
          placeholder: 'Choose a subject',
          options: subjectOptions,
          required: true,
          error: errors.subjectId,
          help: 'Only subjects this tutor teaches are listed.',
        })}

        ${tutor.mode === 'both'
          ? selectField({
              name: 'mode',
              label: 'Session mode',
              value: values.mode || '',
              placeholder: 'Choose how you meet',
              options: [
                { value: 'online', label: 'Online' },
                { value: 'in_person', label: `In person (${tutor.campus || 'on campus'})` },
              ],
              required: true,
              error: errors.mode,
            })
          : html`<div class="field">
              <p class="field__label">Session mode</p>
              <p>${MODE_LABELS[tutor.mode]}</p>
            </div>`}

        ${textareaField({
          name: 'note',
          label: 'What do you need help with?',
          value: values.note || '',
          rows: 5,
          maxlength: config.limits.noteLength,
          error: errors.note,
          help: 'Optional, but tutors accept faster when they know what to prepare.',
          placeholder: 'e.g. I keep getting integration by parts wrong in past papers.',
        })}

        <div class="form__actions">
          ${submitButton('Send request')}
          <a class="btn btn--ghost" href="/tutors/${tutor.id}">Cancel</a>
        </div>
      </form>

      <aside class="card">
        <h2 class="card__title">Session details</h2>
        <dl class="definition">
          <dt>Tutor</dt>
          <dd>${tutor.full_name}</dd>
          <dt>Date</dt>
          <dd>${formatDate(slot.startsAt)}</dd>
          <dt>Time</dt>
          <dd>${formatTime(slot.startsAt)} - ${formatTime(slot.endsAt)} ${timezoneLabel()}</dd>
          <dt>Length</dt>
          <dd>${config.slotMinutes} minutes</dd>
          <dt>Status after sending</dt>
          <dd>${statusBadge('pending')}</dd>
        </dl>
        <p class="text-sm muted">
          You can cancel a request at any time. No payment is taken on the platform.
        </p>
      </aside>
    </div>
  `;
}
