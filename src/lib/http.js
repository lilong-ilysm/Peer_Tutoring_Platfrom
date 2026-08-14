/**
 * HTTP plumbing: cookies, body parsing, responses and flash messages.
 */
import config from '../config.js';
import { payloadTooLarge, badRequest } from './errors.js';
import { sign, unsign } from './security.js';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/* -------------------------------------------------------------- cookies -- */

export function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name || UNSAFE_KEYS.has(name)) continue;
    const value = part.slice(index + 1).trim();
    try {
      jar[name] = decodeURIComponent(value);
    } catch {
      jar[name] = value;
    }
  }
  return jar;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure ?? config.isProduction) segments.push('Secure');
  return segments.join('; ');
}

export function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', [cookie]);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookie]);
  else res.setHeader('Set-Cookie', [existing, cookie]);
}

export function setCookie(res, name, value, options) {
  appendCookie(res, serializeCookie(name, value, options));
}

export function clearCookie(res, name, options = {}) {
  appendCookie(res, serializeCookie(name, '', { ...options, maxAge: 0 }));
}

/* ----------------------------------------------------------------- body -- */

/**
 * Read the request body as a string, enforcing a hard byte ceiling.
 *
 * When the limit is exceeded the rest of the body is drained (up to a sane
 * multiple of the limit) so the app can answer with a proper 413 page instead
 * of resetting the connection and showing the user a browser network error.
 * A genuinely abusive stream is cut off.
 */
export function readBody(req, limit = config.limits.bodyBytes) {
  const drainCeiling = limit * 20;
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    /** @type {Buffer[]} */
    const chunks = [];
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk) {
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        if (size > drainCeiling) {
          finish(payloadTooLarge());
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      if (overflow) finish(payloadTooLarge());
      else finish(null, Buffer.concat(chunks).toString('utf8'));
    }
    function onError(error) {
      finish(error);
    }
    function onAborted() {
      finish(badRequest('The request was interrupted.'));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

function paramsToObject(params) {
  const out = {};
  for (const [key, value] of params) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      if (Array.isArray(out[key])) out[key].push(value);
      else out[key] = [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function queryToObject(searchParams) {
  return paramsToObject(searchParams);
}

/**
 * Parse a request body into a plain object.
 * Supports form encoding (page flows) and JSON (the /api surface).
 */
export async function parseBody(req) {
  const method = req.method?.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return {};
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const raw = await readBody(req);
  if (!raw) return {};

  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw badRequest('Request body must be a JSON object.');
      }
      const out = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (UNSAFE_KEYS.has(key)) continue;
        out[key] = value;
      }
      return out;
    } catch (error) {
      if (error?.status) throw error;
      throw badRequest('Request body is not valid JSON.');
    }
  }

  if (type === 'application/x-www-form-urlencoded' || type === '') {
    return paramsToObject(new URLSearchParams(raw));
  }

  throw badRequest('Unsupported content type.');
}

/* ------------------------------------------------------------ responses -- */

export function sendHtml(res, body, status = 200) {
  const payload = Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendJson(res, data, status = 200) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendText(res, body, status = 200) {
  const payload = Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

export function sendRedirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function sendEmpty(res, status = 204) {
  res.writeHead(status, { 'Cache-Control': 'no-store' });
  res.end();
}

/* --------------------------------------------------------------- flash --- */

const FLASH_COOKIE = 'pl_flash';

/** Queue a one-shot message shown on the page the user lands on. */
export function setFlash(res, flash) {
  if (!flash || !flash.message) return;
  const payload = Buffer.from(
    JSON.stringify({ type: flash.type || 'info', message: String(flash.message).slice(0, 300) })
  ).toString('base64url');
  setCookie(res, FLASH_COOKIE, sign(payload), { maxAge: 120 });
}

/** Read and immediately clear the queued flash message. */
export function takeFlash(cookies, res) {
  const raw = cookies?.[FLASH_COOKIE];
  if (!raw) return null;
  clearCookie(res, FLASH_COOKIE);
  const payload = unsign(raw);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.message !== 'string') return null;
    const type = ['success', 'error', 'info', 'warning'].includes(parsed.type) ? parsed.type : 'info';
    return { type, message: parsed.message };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- misc --- */

/** Best-effort client IP, used only for rate limiting. */
export function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

/** True when the caller wants JSON rather than a rendered page. */
export function wantsJson(req, pathname = '') {
  if (pathname.startsWith('/api/')) return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

/**
 * Only accept internal, non-protocol-relative paths for post-login redirects,
 * so `?next=` can never be used as an open redirect.
 */
export function safeNextPath(value, fallback = '/dashboard') {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw;
}
