/**
 * Notification centre. Clicking a notification marks it read and follows its
 * deep link in one action, so nothing needs to be dismissed twice.
 */
import { csrfField, emptyState, pageHeader, submitButton, timeTag } from '../components.js';
import { html, join, raw } from '../html.js';

export function notificationsPage({ items, csrfToken, unread }) {
  return html`
    ${pageHeader({
      title: 'Notifications',
      subtitle: unread
        ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}.`
        : 'You are up to date.',
      actions: unread
        ? html`<form method="post" action="/notifications/read-all">
            ${csrfField(csrfToken)} ${submitButton('Mark all as read', { variant: 'secondary' })}
          </form>`
        : raw(''),
    })}

    <div class="card card--flush">
      ${items.length === 0
        ? emptyState({
            icon: 'bell',
            title: 'Nothing to catch up on',
            message:
              'Session requests, responses, cancellations, messages and reviews all show up here.',
          })
        : join(
            items.map(
              (item) => html`
                <article class="${item.read_at ? 'notification' : 'notification notification--unread'}">
                  ${item.read_at ? raw('') : html`<span class="notification__dot" aria-hidden="true"></span>`}
                  <div class="notification__body">
                    <p class="notification__title">${item.title}</p>
                    ${item.body ? html`<p class="notification__text">${item.body}</p>` : raw('')}
                    <p class="notification__time">
                      ${timeTag(item.created_at, { relative: true })}
                      ${item.read_at ? raw('') : html`<span class="sr-only">Unread</span>`}
                    </p>
                  </div>
                  <div class="session__actions">
                    ${item.link
                      ? html`<form method="post" action="/notifications/${item.id}/open">
                          ${csrfField(csrfToken)}
                          ${submitButton('Open', { variant: 'secondary', className: 'btn--sm' })}
                        </form>`
                      : raw('')}
                    ${item.read_at
                      ? raw('')
                      : html`<form method="post" action="/notifications/${item.id}/read">
                          ${csrfField(csrfToken)}
                          ${submitButton('Mark read', { variant: 'ghost', className: 'btn--sm' })}
                        </form>`}
                  </div>
                </article>
              `
            )
          )}
    </div>
    ${items.length
      ? html`<p class="text-sm muted">Showing your ${items.length} most recent notifications.</p>`
      : raw('')}
  `;
}
