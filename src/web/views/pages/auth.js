/**
 * Registration and login forms.
 *
 * Both keep submitted values on failure and report errors per field (AC-2).
 */
import config from '../../../config.js';
import { csrfField, errorSummary, submitButton, textField } from '../components.js';
import { html, raw } from '../html.js';

export function registerPage({ values = {}, errors = {}, csrfToken, next = '' }) {
  const role = values.role === 'tutor' ? 'tutor' : 'student';

  return html`
    <div class="split">
      <form class="card form" method="post" action="/register" novalidate>
        <h1>Create your account</h1>
        <p class="muted">
          One account per person. Choose how you will use ${config.appName} - you can always message a
          tutor before booking.
        </p>

        ${errorSummary(errors)} ${csrfField(csrfToken)}
        ${next ? html`<input type="hidden" name="next" value="${next}" />` : raw('')}

        <fieldset class="field">
          <legend class="field__label">I am joining as</legend>
          <div class="field--checkbox">
            <input
              class="checkbox"
              type="radio"
              id="role-student"
              name="role"
              value="student"
              ${role === 'student' ? raw('checked') : raw('')}
            />
            <label class="checkbox__label" for="role-student">
              A student looking for help
            </label>
          </div>
          <div class="field--checkbox">
            <input
              class="checkbox"
              type="radio"
              id="role-tutor"
              name="role"
              value="tutor"
              ${role === 'tutor' ? raw('checked') : raw('')}
            />
            <label class="checkbox__label" for="role-tutor">
              A tutor offering help in subjects I have passed
            </label>
          </div>
          ${errors.role ? html`<p class="field__error" id="role-error">${errors.role}</p>` : raw('')}
        </fieldset>

        ${textField({
          name: 'fullName',
          label: 'Full name',
          value: values.fullName,
          required: true,
          autocomplete: 'name',
          maxlength: 80,
          error: errors.fullName,
        })}
        ${textField({
          name: 'email',
          label: 'Email address',
          type: 'email',
          value: values.email,
          required: true,
          autocomplete: 'email',
          maxlength: 254,
          error: errors.email,
          help: 'Use your institutional address if you have one.',
        })}
        ${textField({
          name: 'password',
          label: 'Password',
          type: 'password',
          required: true,
          autocomplete: 'new-password',
          error: errors.password,
          help: 'At least 10 characters. Longer is better than complicated.',
        })}
        ${textField({
          name: 'confirmPassword',
          label: 'Confirm password',
          type: 'password',
          required: true,
          autocomplete: 'new-password',
          error: errors.confirmPassword,
        })}

        <div class="form__actions">
          ${submitButton('Create account')}
          <span class="text-sm muted">Already registered? <a href="/login">Log in</a></span>
        </div>
      </form>

      <aside class="card">
        <h2 class="card__title">What happens next</h2>
        <ul class="stack text-sm">
          <li><strong>Students:</strong> search tutors, request a slot, get a decision, attend, review.</li>
          <li>
            <strong>Tutors:</strong> build a profile, list subjects, set weekly hours, then publish to
            appear in search.
          </li>
          <li>
            Sessions are ${config.slotMinutes} minutes and need at least ${config.bookingLeadHours}
            hours' notice.
          </li>
          <li>No payment details are ever collected.</li>
        </ul>
      </aside>
    </div>
  `;
}

export function loginPage({ values = {}, errors = {}, csrfToken, next = '' }) {
  return html`
    <div class="split">
      <form class="card form form--narrow" method="post" action="/login" novalidate>
        <h1>Log in</h1>
        <p class="muted">Welcome back to ${config.appName}.</p>

        ${errorSummary(errors)} ${csrfField(csrfToken)}
        ${next ? html`<input type="hidden" name="next" value="${next}" />` : raw('')}

        ${textField({
          name: 'email',
          label: 'Email address',
          type: 'email',
          value: values.email,
          required: true,
          autocomplete: 'email',
          error: errors.email,
        })}
        ${textField({
          name: 'password',
          label: 'Password',
          type: 'password',
          required: true,
          autocomplete: 'current-password',
          error: errors.password,
        })}

        <div class="form__actions">
          ${submitButton('Log in')}
          <span class="text-sm muted">New here? <a href="/register">Create an account</a></span>
        </div>
      </form>

      <aside class="card">
        <h2 class="card__title">Trouble signing in?</h2>
        <ul class="stack text-sm">
          <li>Email addresses are not case sensitive.</li>
          <li>
            After 10 failed attempts from the same network, sign-in is blocked for 10 minutes. The
            limit is enforced on the server.
          </li>
          <li>
            If your account was suspended you will see a message explaining it - contact the academic
            support office.
          </li>
        </ul>
      </aside>
    </div>
  `;
}
