import { html } from '../html.js';

const DEFAULTS = {
  400: { title: 'That request did not work', hint: 'Check the details and try again.' },
  401: { title: 'Please sign in', hint: 'You need to be signed in to see that page.' },
  403: { title: 'No access to that', hint: 'Your account does not have permission for that page.' },
  404: { title: 'Page not found', hint: 'The page you were looking for does not exist.' },
  405: { title: 'That action is not allowed here', hint: 'Go back and try again.' },
  409: { title: 'That conflicts with something', hint: 'Refresh the page to see the latest state.' },
  413: { title: 'That submission is too large', hint: 'Shorten it and try again.' },
  422: { title: 'Some details need fixing', hint: 'Go back and correct the highlighted fields.' },
  429: { title: 'Too many attempts', hint: 'Wait a moment before trying again.' },
  500: { title: 'Something went wrong on our side', hint: 'The problem has been logged. Please try again.' },
};

/**
 * Friendly error page. `message` is only ever a message the server chose to
 * expose - internal faults never reach here (spec 8, AC-49).
 */
export function errorPage({ status = 500, message = '', user = null }) {
  const preset = DEFAULTS[status] || DEFAULTS[500];
  const home = user ? (user.role === 'admin' ? '/admin' : '/dashboard') : '/';
  return html`
    <div class="error-page">
      <p class="error-page__code">${status}</p>
      <h1>${preset.title}</h1>
      <p class="muted">${message || preset.hint}</p>
      <div class="btn-row btn-row--center">
        <a class="btn btn--primary" href="${home}">${user ? 'Back to dashboard' : 'Back to home'}</a>
        <a class="btn btn--secondary" href="/tutors">Browse tutors</a>
      </div>
    </div>
  `;
}
