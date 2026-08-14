/**
 * Inbox and conversation thread.
 *
 * Message bodies are interpolated through the escaping template, so a message
 * containing markup is displayed as text, never executed (AC-32).
 */
import config from '../../../config.js';
import {
  avatar,
  csrfField,
  emptyState,
  pageHeader,
  submitButton,
  textareaField,
  timeTag,
} from '../components.js';
import { html, join, raw } from '../html.js';

export function inboxPage({ conversations, viewer }) {
  return html`
    ${pageHeader({
      title: 'Messages',
      subtitle:
        viewer.role === 'student'
          ? 'Talk to a tutor before or after a session. Start a conversation from any tutor profile.'
          : 'Conversations with the students you tutor.',
      actions:
        viewer.role === 'student'
          ? html`<a class="btn btn--secondary" href="/tutors">Find a tutor</a>`
          : raw(''),
    })}

    <div class="card card--flush">
      ${conversations.length === 0
        ? emptyState({
            icon: 'chat',
            title: 'No conversations yet',
            message:
              viewer.role === 'student'
                ? 'Open a tutor profile and choose "Message" to start talking.'
                : 'When a student messages you it will appear here.',
            actionLabel: viewer.role === 'student' ? 'Browse tutors' : undefined,
            actionHref: viewer.role === 'student' ? '/tutors' : undefined,
          })
        : join(
            conversations.map((conversation) => {
              const isStudent = conversation.student_id === viewer.id;
              const otherName = isStudent ? conversation.tutor_name : conversation.student_name;
              const otherId = isStudent ? conversation.tutor_id : conversation.student_id;
              const preview = conversation.last_body
                ? `${conversation.last_sender_id === viewer.id ? 'You: ' : ''}${conversation.last_body}`
                : 'No messages yet';
              return html`
                <a class="conversation" href="/messages/${conversation.id}">
                  ${avatar(otherName, { size: 'md', id: otherId })}
                  <span class="conversation__body">
                    <span class="conversation__name">${otherName}</span>
                    <span class="conversation__preview">${preview}</span>
                  </span>
                  <span class="conversation__side">
                    ${conversation.last_message_at
                      ? timeTag(conversation.last_message_at, { relative: true })
                      : raw('')}
                    ${conversation.unread > 0
                      ? html`<span class="pill">${conversation.unread}</span>`
                      : raw('')}
                  </span>
                </a>
              `;
            })
          )}
    </div>
  `;
}

export function threadPage({ conversation, other, messages, viewer, csrfToken, error = '' }) {
  const lastId = messages.length ? messages[messages.length - 1].id : 0;

  return html`
    ${pageHeader({
      title: other.name,
      subtitle: other.role === 'tutor' ? 'Tutor' : 'Student',
      actions: html`
        <a class="btn btn--ghost" href="/messages">All conversations</a>
        ${other.role === 'tutor'
          ? html`<a class="btn btn--secondary" href="/tutors/${other.id}">View profile</a>`
          : raw('')}
      `,
    })}

    <div class="card">
      <div class="thread" data-thread="${conversation.id}" data-last-id="${lastId}" tabindex="0" role="log" aria-label="Conversation with ${other.name}">
        ${messages.length === 0
          ? html`<p class="muted text-sm">
              No messages yet. Say hello, and mention the subject you need help with.
            </p>`
          : join(
              messages.map(
                (message) => html`
                  <div class="${message.sender_id === viewer.id ? 'bubble bubble--mine' : 'bubble'}">
                    <span>${message.body}</span>
                    <span class="bubble__meta"
                      >${message.sender_id === viewer.id ? 'You' : message.sender_name} ·
                      ${timeTag(message.created_at, { relative: true })}</span
                    >
                  </div>
                `
              )
            )}
      </div>

      <form class="composer" method="post" action="/messages/${conversation.id}">
        ${csrfField(csrfToken)}
        <div class="composer__field">
          <label class="sr-only" for="body">Message</label>
          ${error
            ? html`<textarea
                class="input input--textarea"
                id="body"
                name="body"
                rows="2"
                maxlength="${config.limits.messageLength}"
                data-counter="true"
                required
                aria-invalid="true"
                aria-describedby="body-error"
                placeholder="Write a message…"
              ></textarea>`
            : html`<textarea
                class="input input--textarea"
                id="body"
                name="body"
                rows="2"
                maxlength="${config.limits.messageLength}"
                data-counter="true"
                required
                placeholder="Write a message…"
              ></textarea>`}
          ${error ? html`<p class="field__error" id="body-error">${error}</p>` : raw('')}
        </div>
        ${submitButton('Send')}
      </form>
    </div>
  `;
}
