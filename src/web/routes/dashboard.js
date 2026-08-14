/**
 * Role-specific dashboard.
 */
import { blocksByWeekday } from '../../services/availability.js';
import {
  bookingCountsFor,
  completedAwaitingReview,
  listBookingsForUser,
  nextSessionFor,
} from '../../services/bookings.js';
import { unreadMessageCount } from '../../services/messages.js';
import { featuredTutors, getTutorProfile, publishRequirements } from '../../services/tutors.js';
import { studentProfileCompleteness } from '../../services/users.js';
import { requireAuth } from '../middleware.js';
import { studentDashboard, tutorDashboard } from '../views/pages/dashboard.js';

export function registerDashboardRoutes(router) {
  router.get('/dashboard', requireAuth, (ctx) => {
    const user = ctx.user;

    if (user.role === 'admin') {
      ctx.redirect('/admin');
      return;
    }

    if (user.role === 'tutor') {
      ctx.render({
        title: 'Dashboard',
        activeNav: 'dashboard',
        body: tutorDashboard({
          viewer: user,
          csrfToken: ctx.csrfToken,
          counts: bookingCountsFor(user),
          profile: getTutorProfile(user.id),
          requirements: publishRequirements(user.id),
          pending: listBookingsForUser(user, { scope: 'pending', pageSize: 5 }).rows,
          upcoming: listBookingsForUser(user, { scope: 'upcoming', pageSize: 5 }).rows.filter(
            (booking) => booking.status === 'confirmed'
          ),
          weeklyBlocks: blocksByWeekday(user.id),
          unreadMessages: unreadMessageCount(user.id),
        }),
      });
      return;
    }

    ctx.render({
      title: 'Dashboard',
      activeNav: 'dashboard',
      body: studentDashboard({
        viewer: user,
        csrfToken: ctx.csrfToken,
        counts: bookingCountsFor(user),
        nextSession: nextSessionFor(user),
        pending: listBookingsForUser(user, { scope: 'pending', pageSize: 3 }).rows,
        awaitingReview: completedAwaitingReview(user.id, 3),
        unreadMessages: unreadMessageCount(user.id),
        completeness: studentProfileCompleteness(user.id),
        suggestions: featuredTutors(3),
      }),
    });
  });
}
