/**
 * Messaging routes.
 */
import { notFound } from '../../lib/errors.js';
import { limiters } from '../../lib/ratelimit.js';
import {
  counterpart,
  getConversationForUser,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from '../../services/messages.js';
import { getPublicTutor } from '../../services/tutors.js';
import { requireRole } from '../middleware.js';
import { inboxPage, threadPage } from '../views/pages/messages.js';
import { attempt, enforce } from './helpers.js';

const requireParticipantRole = requireRole('student', 'tutor');
const requireStudent = requireRole('student');

export function registerMessageRoutes(router) {
  router.get('/messages', requireParticipantRole, (ctx) => {
    ctx.render({
      title: 'Messages',
      activeNav: 'messages',
      body: inboxPage({ conversations: listConversations(ctx.user.id), viewer: ctx.user }),
    });
  });

  /** Start (or reopen) a conversation with a tutor from their profile. */
  router.post('/messages/start', requireStudent, async (ctx) => {
    const tutor = getPublicTutor(ctx.body.tutorId);
    if (!tutor || tutor.status !== 'active') throw notFound('That tutor could not be found.');

    const conversation = await attempt(ctx, `/tutors/${tutor.id}`, () =>
      getOrCreateConversation(ctx.user.id, tutor.id)
    );
    if (!conversation) return;

    ctx.redirect(`/messages/${conversation.id}`);
  });

  router.get('/messages/:id', requireParticipantRole, (ctx) => {
    const conversation = getConversationForUser(ctx.params.id, ctx.user.id);
    if (!conversation) throw notFound('That conversation could not be found.');

    markConversationRead(conversation.id, ctx.user.id);

    ctx.render({
      title: `Chat with ${counterpart(conversation, ctx.user.id).name}`,
      activeNav: 'messages',
      body: threadPage({
        conversation,
        other: counterpart(conversation, ctx.user.id),
        messages: listMessages(conversation.id),
        viewer: ctx.user,
        csrfToken: ctx.csrfToken,
      }),
    });
  });

  router.post('/messages/:id', requireParticipantRole, async (ctx) => {
    const conversation = getConversationForUser(ctx.params.id, ctx.user.id);
    if (!conversation) throw notFound('That conversation could not be found.');

    enforce(
      limiters.message,
      `${ctx.user.id}`,
      'You are sending messages very quickly. Wait a few seconds.'
    );

    const target = `/messages/${conversation.id}`;
    const sent = await attempt(ctx, target, () =>
      sendMessage({
        conversationId: conversation.id,
        senderId: ctx.user.id,
        body: ctx.body.body,
      })
    );
    if (!sent) return;

    ctx.redirect(target);
  });
}
