/**
 * Fixed-window in-memory rate limiter.
 *
 * Sized for the single-node deployment in the spec (assumption A7). If the
 * platform ever runs multiple instances this must move to shared storage -
 * documented in the README limitations section.
 */

export function createLimiter({ windowMs, max, name = 'limiter' }) {
  /** @type {Map<string, {count:number, resetAt:number}>} */
  const buckets = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    name,
    /**
     * Consume one unit for `key`.
     * @returns {{allowed:boolean, remaining:number, retryAfterSeconds:number}}
     */
    consume(key) {
      const now = Date.now();
      sweep(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0 };
    },

    /** Clear a key after a successful action (e.g. a correct login). */
    reset(key) {
      buckets.delete(key);
    },

    clear() {
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
}

/** Shared limiters. Windows are generous enough not to hinder real users. */
export const limiters = {
  login: createLimiter({ name: 'login', windowMs: 10 * 60 * 1000, max: 10 }),
  register: createLimiter({ name: 'register', windowMs: 60 * 60 * 1000, max: 10 }),
  passwordChange: createLimiter({ name: 'passwordChange', windowMs: 15 * 60 * 1000, max: 10 }),
  message: createLimiter({ name: 'message', windowMs: 60 * 1000, max: 30 }),
  booking: createLimiter({ name: 'booking', windowMs: 60 * 1000, max: 15 }),
  review: createLimiter({ name: 'review', windowMs: 60 * 60 * 1000, max: 30 }),
};

/** Test helper: forget every recorded attempt. */
export function clearAllLimiters() {
  for (const limiter of Object.values(limiters)) limiter.clear();
}
