/**
 * Password hashing, token generation and value signing.
 *
 * Everything here uses `node:crypto` primitives - no hand-rolled cryptography
 * and no third-party dependency.
 */
import crypto from 'node:crypto';
import config from '../config.js';

const SCRYPT = Object.freeze({
  N: 16384, // CPU/memory cost
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
});

/**
 * Hash a password with scrypt and a fresh random salt.
 * @returns {string} `scrypt$N$r$p$saltB64$hashB64`
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('hashPassword requires a non-empty string');
  }
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification of a password against a stored hash.
 * Never throws on malformed input - it simply fails.
 */
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT.maxmem,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Hex SHA-256 digest. Session cookies are stored only as this digest. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(String(value)).digest('base64url');
}

/** Append an HMAC so a client-visible value cannot be tampered with. */
export function sign(value) {
  return `${value}.${hmac(value)}`;
}

/** Verify and strip a signature produced by `sign`. Returns null when invalid. */
export function unsign(signed) {
  if (typeof signed !== 'string') return null;
  const index = signed.lastIndexOf('.');
  if (index <= 0) return null;
  const value = signed.slice(0, index);
  const signature = signed.slice(index + 1);
  const expected = hmac(value);
  if (!timingSafeEqualStrings(signature, expected)) return null;
  return value;
}

/** Length-safe constant-time string comparison. */
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Password policy (spec section 7.1): at least 10 characters, and not a single
 * repeated character. Deliberately simple and explainable to users.
 * @returns {string|null} an error message, or null when acceptable
 */
export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (password.length > 200) {
    return 'Password must be 200 characters or fewer.';
  }
  if (/^(.)\1+$/.test(password)) {
    return 'Password cannot be a single repeated character.';
  }
  return null;
}

/** Deterministic 0-7 bucket used to colour generated avatars. */
export function avatarBucket(seed) {
  const digest = crypto.createHash('sha1').update(String(seed || '')).digest();
  return digest[0] % 8;
}
