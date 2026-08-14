/**
 * Route guards.
 *
 * Guards run before the handler and throw to stop the chain. They are the first
 * layer of authorisation; services re-check ownership so a missing guard can
 * never on its own expose another user's data (defence in depth, spec 6).
 */
import { forbidden, RedirectError, unauthorized } from '../lib/errors.js';

/** Require any signed-in user. */
export function requireAuth(ctx) {
  if (ctx.user) return;
  if (ctx.isJson) throw unauthorized('Sign in to continue.');
  const next = encodeURIComponent(ctx.pathname + (ctx.url.search || ''));
  throw new RedirectError(`/login?next=${next}`, {
    type: 'info',
    message: 'Please sign in to continue.',
  });
}

/** Require one of the given roles. */
export function requireRole(...roles) {
  return function guard(ctx) {
    requireAuth(ctx);
    if (!roles.includes(ctx.user.role)) {
      throw forbidden(
        `That area is for ${roles.map(labelForRole).join(' or ')} accounts. You are signed in as a ${labelForRole(
          ctx.user.role
        )}.`
      );
    }
  };
}

export const requireStudent = requireRole('student');
export const requireTutor = requireRole('tutor');
export const requireAdmin = requireRole('admin');

/** Signed-in users should not see the login/registration forms. */
export function requireGuest(ctx) {
  if (ctx.user) {
    throw new RedirectError(ctx.user.role === 'admin' ? '/admin' : '/dashboard', {
      type: 'info',
      message: 'You are already signed in.',
    });
  }
}

function labelForRole(role) {
  return { student: 'student', tutor: 'tutor', admin: 'administrator' }[role] || role;
}
