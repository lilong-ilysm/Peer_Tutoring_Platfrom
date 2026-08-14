/**
 * Account settings, tutor subjects and availability management.
 */
import config from '../../../config.js';
import { minutesToTime, timezoneLabel, WEEKDAY_NAMES } from '../../../lib/time.js';
import {
  badge,
  csrfField,
  emptyState,
  errorSummary,
  LEVEL_LABELS,
  pageHeader,
  selectField,
  submitButton,
  textareaField,
  textField,
} from '../components.js';
import { html, join, raw } from '../html.js';

const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((name, index) => ({ value: index, label: name }));

/** Shared account block (name, email, password change). */
function accountSection({ viewer, values, errors, csrfToken, passwordErrors }) {
  return html`
    <section class="card">
      <h2 class="card__title">Account</h2>
      <form class="form" method="post" action="/profile/account" novalidate>
        ${csrfField(csrfToken)}
        ${textField({
          name: 'fullName',
          label: 'Full name',
          value: values.fullName ?? viewer.full_name,
          required: true,
          maxlength: 80,
          autocomplete: 'name',
          error: errors.fullName,
        })}
        ${textField({
          name: 'email',
          label: 'Email address',
          value: viewer.email,
          readonly: true,
          help: 'Contact the academic support office if your email needs to change.',
        })}
        ${submitButton('Save account details')}
      </form>

      <hr />

      <h3>Change password</h3>
      ${errorSummary(passwordErrors)}
      <form class="form" method="post" action="/profile/password" novalidate>
        ${csrfField(csrfToken)}
        ${textField({
          name: 'currentPassword',
          label: 'Current password',
          type: 'password',
          required: true,
          autocomplete: 'current-password',
          error: passwordErrors.currentPassword,
        })}
        ${textField({
          name: 'newPassword',
          label: 'New password',
          type: 'password',
          required: true,
          autocomplete: 'new-password',
          help: 'At least 10 characters.',
          error: passwordErrors.newPassword,
        })}
        ${textField({
          name: 'confirmPassword',
          label: 'Confirm new password',
          type: 'password',
          required: true,
          autocomplete: 'new-password',
          error: passwordErrors.confirmPassword,
        })}
        ${submitButton('Change password', { variant: 'secondary' })}
      </form>
      <p class="text-sm muted">
        Changing your password signs you out everywhere else. This device stays signed in.
      </p>
    </section>
  `;
}

export function studentProfilePage({
  viewer,
  profile,
  values = {},
  errors = {},
  passwordErrors = {},
  csrfToken,
}) {
  return html`
    ${pageHeader({
      title: 'Profile settings',
      subtitle: 'Tutors see this when you request a session.',
    })}

    <div class="split">
      <section class="card">
        <h2 class="card__title">Student profile</h2>
        ${errorSummary(errors)}
        <form class="form" method="post" action="/profile/student" novalidate>
          ${csrfField(csrfToken)}
          ${textField({
            name: 'programme',
            label: 'Programme of study',
            value: values.programme ?? profile.programme,
            maxlength: 120,
            placeholder: 'e.g. BSc Computer Science',
            error: errors.programme,
          })}
          ${selectField({
            name: 'yearOfStudy',
            label: 'Year of study',
            value: values.yearOfStudy ?? profile.year_of_study ?? '',
            placeholder: 'Not saying',
            options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((year) => ({
              value: year,
              label: `Year ${year}`,
            })),
            error: errors.yearOfStudy,
          })}
          ${textareaField({
            name: 'goals',
            label: 'What are you working towards?',
            value: values.goals ?? profile.goals,
            rows: 3,
            maxlength: 500,
            help: 'A test in three weeks? A specific topic? Tutors prepare better when they know.',
            error: errors.goals,
          })}
          ${textareaField({
            name: 'bio',
            label: 'About you',
            value: values.bio ?? profile.bio,
            rows: 4,
            maxlength: config.limits.bioLength,
            error: errors.bio,
          })}
          ${submitButton('Save profile')}
        </form>
      </section>

      ${accountSection({ viewer, values, errors, csrfToken, passwordErrors })}
    </div>
  `;
}

export function tutorProfileSettingsPage({
  viewer,
  profile,
  requirements,
  values = {},
  errors = {},
  passwordErrors = {},
  csrfToken,
}) {
  return html`
    ${pageHeader({
      title: 'Profile settings',
      subtitle: 'This is what students see in search results and on your public profile.',
      actions: html`<a class="btn btn--ghost" href="/tutors/${viewer.id}">View public profile</a>`,
    })}

    ${requirements.ok
      ? raw('')
      : html`<div class="alert alert--warning">
          <span class="alert__label">Not visible in search yet:</span>
          <ul class="alert__list">
            ${requirements.missing.map((item) => html`<li>${item}</li>`)}
          </ul>
        </div>`}

    <div class="split">
      <section class="card">
        <h2 class="card__title">Tutor profile</h2>
        ${errorSummary(errors)}
        <form class="form" method="post" action="/profile/tutor" novalidate>
          ${csrfField(csrfToken)}
          ${textField({
            name: 'headline',
            label: 'Headline',
            value: values.headline ?? profile.headline,
            required: true,
            maxlength: 120,
            placeholder: 'e.g. Third-year maths student, distinction in Calculus I',
            help: 'One line that tells a student why you can help.',
            error: errors.headline,
          })}
          ${textareaField({
            name: 'bio',
            label: 'About your tutoring',
            value: values.bio ?? profile.bio,
            rows: 6,
            maxlength: config.limits.bioLength,
            help: 'How you run a session, what you are good at explaining, what to bring.',
            error: errors.bio,
          })}
          ${selectField({
            name: 'mode',
            label: 'How do you meet students?',
            value: values.mode ?? profile.mode,
            required: true,
            options: [
              { value: 'online', label: 'Online only' },
              { value: 'in_person', label: 'In person only' },
              { value: 'both', label: 'Online or in person' },
            ],
            error: errors.mode,
          })}
          ${textField({
            name: 'campus',
            label: 'Campus meeting spot',
            value: values.campus ?? profile.campus,
            maxlength: 120,
            placeholder: 'e.g. Main library, group study area 2',
            help: 'Required for in-person sessions.',
            error: errors.campus,
          })}
          ${textField({
            name: 'meetingLink',
            label: 'Online meeting link',
            value: values.meetingLink ?? profile.meeting_link,
            type: 'url',
            maxlength: 500,
            placeholder: 'https://…',
            help: 'Required for online sessions. Shared with students once a session is confirmed.',
            error: errors.meetingLink,
          })}
          <div class="field-row">
            ${textField({
              name: 'hourlyRate',
              label: `Indicative rate (${config.currencySymbol} per hour)`,
              value:
                values.hourlyRate ??
                (profile.hourly_rate_cents ? (profile.hourly_rate_cents / 100).toFixed(2) : '0'),
              type: 'number',
              min: 0,
              step: '0.5',
              inputmode: 'decimal',
              help: 'Enter 0 if you tutor for free. No money is handled by the platform.',
              error: errors.hourlyRate,
            })}
            ${textField({
              name: 'yearsExperience',
              label: 'Years tutoring',
              value: values.yearsExperience ?? profile.years_experience,
              type: 'number',
              min: 0,
              max: 30,
              inputmode: 'numeric',
              error: errors.yearsExperience,
            })}
          </div>
          ${submitButton('Save tutor profile')}
        </form>
      </section>

      <div class="stack">
        <section class="card">
          <h2 class="card__title">Publication</h2>
          <p class="text-sm muted">
            ${profile.is_published
              ? 'Your profile is live and appears in search.'
              : 'Your profile is hidden. Publish it to receive requests.'}
          </p>
          <div class="btn-row">
            ${profile.is_published
              ? html`<form method="post" action="/profile/unpublish">
                  ${csrfField(csrfToken)} ${submitButton('Unpublish', { variant: 'secondary' })}
                </form>`
              : html`<form method="post" action="/profile/publish">
                  ${csrfField(csrfToken)} ${submitButton('Publish profile')}
                </form>`}
          </div>
          <p class="text-sm muted">
            <a href="/profile/subjects">Manage subjects</a> ·
            <a href="/profile/availability">Manage availability</a>
          </p>
        </section>

        ${accountSection({ viewer, values, errors, csrfToken, passwordErrors })}
      </div>
    </div>
  `;
}

export function tutorSubjectsPage({ mine, catalogue, csrfToken, errors = {}, values = {} }) {
  const available = catalogue.filter(
    (subject) => !mine.some((entry) => entry.subject_id === subject.id)
  );

  return html`
    ${pageHeader({
      title: 'My subjects',
      subtitle: 'Students filter by subject and level, so keep this accurate.',
      actions: html`<a class="btn btn--ghost" href="/profile">Profile settings</a>`,
    })}

    <div class="split">
      <section class="card card--flush">
        <div class="card__head card__head--flush">
          <h2 class="card__title">Subjects you teach</h2>
        </div>
        ${mine.length === 0
          ? emptyState({
              icon: 'inbox',
              title: 'No subjects yet',
              message: 'Add at least one subject before publishing your profile.',
            })
          : join(
              mine.map(
                (entry) => html`
                  <div class="list__item">
                    <div>
                      <strong>${entry.name}</strong>
                      <span class="text-sm muted">${entry.code}</span><br />
                      ${badge(LEVEL_LABELS[entry.level], 'brand')}
                      ${entry.is_active ? raw('') : badge('Retired subject', 'warning')}
                    </div>
                    <form method="post" action="/profile/subjects/remove">
                      ${csrfField(csrfToken)}
                      <input type="hidden" name="subjectId" value="${entry.subject_id}" />
                      ${submitButton('Remove', { variant: 'danger', className: 'btn--sm' })}
                    </form>
                  </div>
                `
              )
            )}
      </section>

      <section class="card">
        <h2 class="card__title">Add a subject</h2>
        ${errorSummary(errors)}
        ${available.length === 0
          ? html`<p class="muted text-sm">
              You have added every subject in the catalogue. Ask an administrator if something is
              missing.
            </p>`
          : html`<form class="form" method="post" action="/profile/subjects" novalidate>
              ${csrfField(csrfToken)}
              ${selectField({
                name: 'subjectId',
                label: 'Subject',
                value: values.subjectId || '',
                placeholder: 'Choose a subject',
                required: true,
                options: available.map((subject) => ({
                  value: subject.id,
                  label: `${subject.name} (${subject.code})`,
                })),
                error: errors.subjectId,
              })}
              ${selectField({
                name: 'level',
                label: 'Highest level you can teach',
                value: values.level || '',
                placeholder: 'Choose a level',
                required: true,
                options: Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label })),
                error: errors.level,
              })}
              ${submitButton('Add subject')}
            </form>`}
      </section>
    </div>
  `;
}

export function availabilityPage({
  weeklyBlocks,
  timeOff,
  requirements,
  slotCount,
  csrfToken,
  errors = {},
  values = {},
}) {
  return html`
    ${pageHeader({
      title: 'My availability',
      subtitle: `Weekly hours in ${timezoneLabel()}. Students can only book inside these blocks, in ${config.slotMinutes}-minute sessions.`,
      actions: html`<a class="btn btn--ghost" href="/profile">Profile settings</a>`,
    })}

    ${requirements.ok
      ? raw('')
      : html`<div class="alert alert--info">
          <span class="alert__label">Before students can find you:</span>
          <ul class="alert__list">
            ${requirements.missing.map((item) => html`<li>${item}</li>`)}
          </ul>
        </div>`}

    <div class="split">
      <div class="stack">
        <section class="card">
          <div class="card__head">
            <h2 class="card__title">Weekly pattern</h2>
            <span class="text-sm muted">${slotCount} bookable slots in the next ${config.bookingWindowDays} days</span>
          </div>
          <div class="week">
            ${join(
              weeklyBlocks.map(
                (blocks, weekday) => html`
                  <div class="week__day">
                    <span class="week__name">${WEEKDAY_NAMES[weekday]}</span>
                    <div class="chips">
                      ${blocks.length === 0
                        ? html`<span class="text-sm muted">Not available</span>`
                        : join(
                            blocks.map(
                              (block) => html`
                                <span class="block-chip">
                                  ${minutesToTime(block.start_minute)} -
                                  ${minutesToTime(block.end_minute)}
                                  <form method="post" action="/profile/availability/remove">
                                    ${csrfField(csrfToken)}
                                    <input type="hidden" name="blockId" value="${block.id}" />
                                    <button
                                      class="block-chip__remove"
                                      type="submit"
                                      aria-label="Remove ${WEEKDAY_NAMES[weekday]} ${minutesToTime(
                                        block.start_minute
                                      )} to ${minutesToTime(block.end_minute)}"
                                      data-submit-once="true"
                                    >
                                      ×
                                    </button>
                                  </form>
                                </span>
                              `
                            )
                          )}
                    </div>
                  </div>
                `
              )
            )}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Time off</h2>
          <p class="text-sm muted">
            Mark a specific date as unavailable without changing your weekly pattern.
          </p>
          ${timeOff.length === 0
            ? html`<p class="muted text-sm">No upcoming time off.</p>`
            : html`<div class="chips">
                ${timeOff.map(
                  (entry) => html`
                    <span class="block-chip">
                      ${entry.date}${entry.note ? ` · ${entry.note}` : ''}
                      <form method="post" action="/profile/availability/time-off/remove">
                        ${csrfField(csrfToken)}
                        <input type="hidden" name="timeOffId" value="${entry.id}" />
                        <button
                          class="block-chip__remove"
                          type="submit"
                          aria-label="Remove time off on ${entry.date}"
                          data-submit-once="true"
                        >
                          ×
                        </button>
                      </form>
                    </span>
                  `
                )}
              </div>`}
          <hr />
          <form class="form" method="post" action="/profile/availability/time-off" novalidate>
            ${csrfField(csrfToken)}
            <div class="field-row">
              ${textField({
                name: 'date',
                label: 'Date',
                type: 'date',
                value: values.date || '',
                required: true,
                error: errors.date,
              })}
              ${textField({
                name: 'note',
                label: 'Note (optional)',
                value: values.note || '',
                maxlength: 120,
                placeholder: 'e.g. Exam',
                error: errors.note,
              })}
            </div>
            ${submitButton('Add time off', { variant: 'secondary' })}
          </form>
        </section>
      </div>

      <section class="card">
        <h2 class="card__title">Add availability</h2>
        ${errorSummary(errors)}
        <form class="form" method="post" action="/profile/availability" novalidate>
          ${csrfField(csrfToken)}
          ${selectField({
            name: 'weekday',
            label: 'Day',
            value: values.weekday ?? '',
            placeholder: 'Choose a day',
            required: true,
            options: WEEKDAY_OPTIONS,
            error: errors.weekday,
          })}
          <div class="field-row">
            ${textField({
              name: 'start',
              label: 'From',
              type: 'time',
              value: values.start || '09:00',
              required: true,
              error: errors.start,
            })}
            ${textField({
              name: 'end',
              label: 'To',
              type: 'time',
              value: values.end || '11:00',
              required: true,
              error: errors.end,
            })}
          </div>
          <p class="field__help">
            Blocks must be at least ${config.slotMinutes} minutes and cannot overlap another block on
            the same day.
          </p>
          ${submitButton('Add block')}
        </form>
      </section>
    </div>
  `;
}
