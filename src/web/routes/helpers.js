/**
 * Small helpers shared by route modules.
 */
import { HttpError, tooManyRequests, ValidationError } from '../../lib/errors.js';
import { coerceInt } from '../../lib/validate.js';

/**
 * Run a mutation. Business-rule failures (DomainError) become a redirect with
 * an error flash, so the user lands somewhere useful with a clear explanation
 * instead of on an error page.
 *
 * @param {object} ctx request context
 * @param {string} redirectTo where to send the user when the action fails
 * @param {() => any} action
 */
export async function attempt(ctx, redirectTo, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ValidationError) {
      const first = Object.values(error.fieldErrors || {})[0] || error.message;
      ctx.redirect(redirectTo, { type: 'error', message: first });
      return null;
    }
    if (error instanceof HttpError && error.expose && error.status < 500) {
      ctx.redirect(redirectTo, { type: 'error', message: error.message });
      return null;
    }
    throw error;
  }
}

/** Enforce a rate limit for the given key, or fail with 429. */
export function enforce(limiter, key, message) {
  const result = limiter.consume(key);
  if (!result.allowed) {
    throw tooManyRequests(
      message || `Too many attempts. Try again in about ${result.retryAfterSeconds} seconds.`
    );
  }
  return result;
}

export function pageFromQuery(query, key = 'page') {
  return coerceInt(query[key], 1, { min: 1, max: 10000 });
}

/** Where a signed-in user belongs by default. */
export function homeFor(user) {
  if (!user) return '/';
  return user.role === 'admin' ? '/admin' : '/dashboard';
}
