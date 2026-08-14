/**
 * Notification centre routes.
 */
import { notFound } from '../../lib/errors.js';
import { safeNextPath } from '../../lib/http.js';
import {
  getNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from '../../services/notifications.js';
import { requireAuth } from '../middleware.js';
import { notificationsPage } from '../views/pages/notifications.js';

export function registerNotificationRoutes(router) {
  router.get('/notifications', requireAuth, (ctx) => {
    ctx.render({
      title: 'Notifications',
      activeNav: 'notifications',
      body: notificationsPage({
        items: listNotifications(ctx.user.id, { limit: 50 }),
        unread: unreadCount(ctx.user.id),
        csrfToken: ctx.csrfToken,
      }),
    });
  });

  router.post('/notifications/read-all', requireAuth, (ctx) => {
    const changed = markAllRead(ctx.user.id);
    ctx.redirect('/notifications', {
      type: 'success',
      message: changed ? `${changed} notification${changed === 1 ? '' : 's'} marked as read.` : 'Nothing to mark.',
    });
  });

  router.post('/notifications/:id/read', requireAuth, (ctx) => {
    const notification = getNotification(ctx.user.id, ctx.params.id);
    if (!notification) throw notFound('That notification could not be found.');
    markRead(ctx.user.id, notification.id);
    ctx.redirect('/notifications');
  });

  /** Mark read and follow the deep link in one action. */
  router.post('/notifications/:id/open', requireAuth, (ctx) => {
    const notification = getNotification(ctx.user.id, ctx.params.id);
    if (!notification) throw notFound('That notification could not be found.');
    markRead(ctx.user.id, notification.id);
    ctx.redirect(safeNextPath(notification.link, '/notifications'));
  });
}
