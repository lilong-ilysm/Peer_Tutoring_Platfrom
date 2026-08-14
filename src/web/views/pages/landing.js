/**
 * Landing page.
 *
 * Design rule applied here (see docs/05-design-review.md): the home page is the
 * front door of a tool, not a brochure. The first interactive element is a real
 * search that submits to /tutors, the numbers are one line of plain text rather
 * than three decorative tiles, and there is exactly one marketing sentence.
 * Everything below it is live data a visitor can act on.
 */
import config from '../../../config.js';
import { timezoneLabel } from '../../../lib/time.js';
import { emptyState, paymentNote, selectField, submitButton, textField } from '../components.js';
import { html, raw } from '../html.js';
import { tutorCard } from './tutors.js';

const STEPS = [
  ['Search', 'Filter by subject, level, price and the days you are free.'],
  ['Compare', 'Ratings and reviews come from completed sessions only.'],
  ['Request', 'Pick a real open slot; the tutor confirms it.'],
  ['Meet', 'Attend, then review the session.'],
];

const SUBJECT_CHIP_LIMIT = 12;

export function landingPage({ stats, featured, subjects }) {
  const covered = subjects.filter((subject) => subject.tutor_count > 0);
  const shown = covered.slice(0, SUBJECT_CHIP_LIMIT);

  return html`
    <section class="intro">
      <h1 class="intro__title">Find a peer tutor for the subject you are stuck on</h1>
      <p class="intro__lead">
        ${config.appName} connects students who need help with students who have already passed the
        subject. Search, pick a time that is genuinely free, and the tutor confirms it.
      </p>

      <form class="home-search" method="get" action="/tutors" role="search">
        <h2 class="sr-only">Search for a tutor</h2>
        <div class="home-search__row">
          ${textField({
            name: 'q',
            label: 'What do you need help with?',
            placeholder: 'e.g. calculus, programming, essay structure',
            maxlength: 80,
          })}
          ${selectField({
            name: 'subject',
            label: 'Subject',
            placeholder: 'Any subject',
            options: covered.map((subject) => ({
              value: subject.id,
              label: `${subject.name} (${subject.tutor_count})`,
            })),
          })}
          <div class="home-search__submit">${submitButton('Search tutors')}</div>
        </div>
      </form>

      <p class="facts">
        <span><strong>${stats.tutors}</strong> tutors taking bookings</span>
        <span><strong>${stats.subjectsCovered}</strong> subjects with a tutor</span>
        <span><strong>${stats.completedSessions}</strong> sessions completed</span>
        <span>Times shown in ${timezoneLabel()}</span>
      </p>
      ${paymentNote()}
    </section>

    ${covered.length
      ? html`<section class="section">
          <div class="section__head">
            <h2 class="section__title">Subjects with a tutor available</h2>
            ${covered.length > shown.length
              ? html`<span class="text-sm muted"
                  >Showing ${shown.length} of ${covered.length} —
                  <a href="/tutors">see all tutors</a></span
                >`
              : html`<a class="section__link" href="/tutors">See all tutors</a>`}
          </div>
          <div class="chips">
            ${shown.map(
              (subject) => html`<a class="chip-link" href="/tutors?subject=${subject.id}"
                >${subject.name}
                <span class="chip-link__count">${subject.tutor_count}</span></a
              >`
            )}
          </div>
        </section>`
      : raw('')}

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Tutors available now</h2>
        <a class="section__link" href="/tutors">Browse all tutors</a>
      </div>
      ${featured.length === 0
        ? html`<div class="card">
            ${emptyState({
              icon: 'users',
              title: 'No published tutors yet',
              message:
                'A tutor appears here once they have a headline, at least one subject and weekly availability.',
              actionLabel: 'Become a tutor',
              actionHref: '/register?role=tutor',
            })}
          </div>`
        : html`<div class="tutor-grid">${featured.map(tutorCard)}</div>`}
    </section>

    <section class="section" id="how-it-works">
      <div class="section__head">
        <h2 class="section__title">How booking works</h2>
      </div>
      <ol class="steps steps--compact">
        ${STEPS.map(
          ([title, text], index) => html`<li class="step">
            <span class="step__number">${index + 1}</span>
            <h3 class="step__title">${title}</h3>
            <p class="step__text">${text}</p>
          </li>`
        )}
      </ol>
      <p class="text-sm muted">
        Tutoring instead? <a href="/register?role=tutor">Create a tutor profile</a> — you set weekly
        hours, approve every request, and only appear in search once your profile is complete.
      </p>
    </section>
  `;
}
