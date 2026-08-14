/**
 * Route registry. Order matters only where patterns could overlap:
 * `/bookings/new` is registered before `/bookings/:id`.
 */
import { registerAdminRoutes } from './admin.js';
import { registerApiRoutes } from './api.js';
import { registerAuthRoutes } from './auth.js';
import { registerBookingRoutes } from './bookings.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerMessageRoutes } from './messages.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerProfileRoutes } from './profile.js';
import { registerPublicRoutes } from './public.js';

export function registerRoutes(router) {
  registerAuthRoutes(router);
  registerDashboardRoutes(router);
  registerProfileRoutes(router);
  registerBookingRoutes(router);
  registerMessageRoutes(router);
  registerNotificationRoutes(router);
  registerAdminRoutes(router);
  registerApiRoutes(router);
  // Public routes last: `/` and `/tutors/:id` are the broadest patterns.
  registerPublicRoutes(router);
  return router;
}
