/**
 * Landing page: explain the product, prove there is supply, drive sign-up.
 */
import config from '../../../config.js';
import { timezoneLabel } from '../../../lib/time.js';
import { badge, emptyState, statTile } from '../components.js';
import { html, join, raw } from '../html.js';
import { tutorCard } from './tutors.js';

const STUDENT_STEPS = [
  ['Search', 'Filter tutors by subject, level, price and the days you are actually free.'],
  ['Compare', 'Read peer reviews and see exactly what each tutor teaches.'],
  ['Request', 'Pick an open slot from their calendar and say what you need help with.'],
  ['Meet', 'The tutor confirms, you attend, then you leave a review.'],
];

const TUTOR_STEPS = [
  ['Create a profile', 'Say what you teach, at what level, and how you meet students.'],
  ['Set your hours', 'Add weekly availability blocks. You are never bookable outside them.'],
  ['Approve requests', 'Accept the sessions that suit you, decline the ones that do not.'],
  ['Build a record', 'Completed sessions and reviews build a reputation you can point to.'],
];

export function landingPage({ stats, featured, subjects }) {
  const topSubjects = subjects.filter((subject) => subject.tutor_count > 0).slice(0, 12);

  return html`
    <section class="hero">
      <div>
        <span class="hero__eyebrow">Campus peer tutoring</span>
        <h1 class="hero__title">Get unstuck with a student who has already passed it</h1>
        <p class="hero__lead">
          ${config.appName} connects students who need help with peers who can give it. Search by
          subject, see real availability, and book a session in a couple of clicks - no group-chat
          negotiation required.
        </p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="/tutors">Find a tutor</a>
          <a class="btn btn--secondary" href="/register?role=tutor">Become a tutor</a>
        </div>
        <p class="text-sm muted">
          Free to use. No payments are processed here. All times shown in ${timezoneLabel()}.
        </p>
      </div>

      <div class="hero__panel">
        <h2 class="card__title">On the platform right now</h2>
        <div class="grid grid--3">
          ${statTile({ label: 'Tutors taking bookings', value: stats.tutors, tone: 'info' })}
          ${statTile({ label: 'Subjects covered', value: stats.subjects })}
          ${statTile({ label: 'Sessions completed', value: stats.completedSessions, tone: 'success' })}
        </div>
        <p class="text-sm muted">
          Every tutor listed has a published profile, at least one subject and real availability.
        </p>
      </div>
    </section>

    <section class="section" id="how-it-works">
      <div class="section__head">
        <h2 class="section__title">How it works</h2>
      </div>
      <div class="split">
        <div class="card">
          <h3>If you need help</h3>
          <div class="steps">
            ${join(
              STUDENT_STEPS.map(
                ([title, text], index) => html`
                  <div class="step">
                    <span class="step__number">${index + 1}</span>
                    <h4 class="step__title">${title}</h4>
                    <p class="step__text">${text}</p>
                  </div>
                `
              )
            )}
          </div>
          <p class="text-sm muted">
            You always see the status of a request: pending, confirmed, declined or cancelled.
          </p>
        </div>
        <div class="card">
          <h3>If you can help</h3>
          <div class="steps">
            ${join(
              TUTOR_STEPS.map(
                ([title, text], index) => html`
                  <div class="step">
                    <span class="step__number">${index + 1}</span>
                    <h4 class="step__title">${title}</h4>
                    <p class="step__text">${text}</p>
                  </div>
                `
              )
            )}
          </div>
          <p class="text-sm muted">You control your hours, and you approve every booking.</p>
        </div>
      </div>
    </section>

    ${topSubjects.length
      ? html`<section class="section">
          <div class="section__head">
            <h2 class="section__title">Subjects with tutors available</h2>
            <a class="section__link" href="/tutors">See all tutors</a>
          </div>
          <div class="chips">
            ${topSubjects.map(
              (subject) => html`<a class="badge badge--brand" href="/tutors?subject=${subject.id}"
                >${subject.name} · ${subject.tutor_count}</a
              >`
            )}
          </div>
        </section>`
      : raw('')}

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Tutors students come back to</h2>
        <a class="section__link" href="/tutors">Browse all</a>
      </div>
      ${featured.length === 0
        ? emptyState({
            icon: 'users',
            title: 'No published tutors yet',
            message:
              'Be the first: create a tutor profile, add a subject and your weekly hours, and students will find you.',
            actionLabel: 'Become a tutor',
            actionHref: '/register?role=tutor',
          })
        : html`<div class="tutor-grid">${featured.map(tutorCard)}</div>`}
    </section>

    <section class="card">
      <div class="page-header">
        <div class="page-header__text">
          <h2>Ready to start?</h2>
          <p class="muted">
            Create an account in under a minute. Students book sessions; tutors publish availability.
          </p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--primary" href="/register">Create an account</a>
          <a class="btn btn--ghost" href="/login">I already have one</a>
        </div>
      </div>
      <div class="chips">
        ${badge('No payments on platform', 'neutral')} ${badge('Peer reviewed', 'neutral')}
        ${badge('You control your data', 'neutral')}
      </div>
    </section>
  `;
}
