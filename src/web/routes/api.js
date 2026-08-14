/**
 * Small JSON surface used by the progressive-enhancement script.
 *
 * Read-only, session-authenticated, and scoped to the caller: the same
 * authorisation rules as the pages they support.
 */
import { notFound } from '../../lib/errors.js';
import { coerceInt } from '../../lib/validate.js';
import {
  getConversationForUser,
  listMessages,
  markConversationRead,
} from '../../services/messages.js';
import { unreadCount } from '../../services/notifications.js';
import { requireAuth } from '../middleware.js';

export function registerApiRoutes(router) {
  /** Badge count for the header bell. */
  router.get('/api/notifications/unread-count', requireAuth, (ctx) => {
    ctx.json({ count: unreadCount(ctx.user.id) });
  });

  /** Incremental message polling for an open thread. */
  router.get('/api/conversations/:id/messages', requireAuth, (ctx) => {
    const conversation = getConversationForUser(ctx.params.id, ctx.user.id);
    if (!conversation) throw notFound('Conversation not found.');

    const after = coerceInt(ctx.query.after, 0, { min: 0 });
    const messages = listMessages(conversation.id, { afterId: after, limit: 50 });
    if (messages.length) markConversationRead(conversation.id, ctx.user.id);

    ctx.json({
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        created_at: message.created_at,
        sender_name: message.sender_id === ctx.user.id ? 'You' : message.sender_name,
        mine: message.sender_id === ctx.user.id,
      })),
    });
  });
}
