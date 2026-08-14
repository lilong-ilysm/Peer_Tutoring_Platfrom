/**
 * Request pipeline.
 *
 * Order of work per request:
 *   1. security headers
 *   2. static assets
 *   3. cookies -> session -> request context (user, CSRF token, flash)
 *   4. route match (404 / 405 when nothing matches)
 *   5. body parsing + CSRF verification for unsafe methods
 *   6. guards, then the handler
 *   7. error translation: redirect / friendly page / JSON, never a stack trace
 */
import http from 'node:http';
import config from '../config.js';
import { HttpError, RedirectError, ValidationError } from '../lib/errors.js';
import {
  clientIp,
  parseBody,
  parseCookies,
  queryToObject,
  sendHtml,
  sendJson,
  sendRedirect,
  setCookie,
  setFlash,
  takeFlash,
  wantsJson,
} from '../lib/http.js';
import logger from '../lib/logger.js';
import { randomToken, sign, timingSafeEqualStrings, unsign } from '../lib/security.js';
import { Router } from '../lib/router.js';
import { resolveSession, SESSION_COOKIE } from '../services/auth.js';
import { unreadMessageCount } from '../services/messages.js';
import { unreadCount } from '../services/notifications.js';
import { registerRoutes } from './routes/index.js';
import { serveStatic } from './static.js';
import { errorPage } from './views/pages/error.js';
import { layout } from './views/layout.js';

const CSRF_COOKIE = 'pl_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const router = new Router();
registerRoutes(router);

/** Token used to protect state-changing requests, per session or per visitor. */
function resolveCsrfToken(ctx) {
  if (ctx.session) return ctx.session.csrf_token;
  const existing = unsign(ctx.cookies[CSRF_COOKIE] || '');
  if (existing) return existing;
  const token = randomToken(24);
  setCookie(ctx.res, CSRF_COOKIE, sign(token), { maxAge: 4 * 3600 });
  return token;
}

function verifyCsrf(ctx) {
  const provided = ctx.body?._csrf || ctx.req.headers['x-csrf-token'] || '';
  if (provided && timingSafeEqualStrings(String(provided), ctx.csrfToken)) return;
  throw new HttpError(
    403,
    'That form could not be verified, usually because the page was open for a long time. Reload the page and try again.',
    { code: 'csrf_failed' }
  );
}

function buildContext(req, res, url) {
  const cookies = parseCookies(req.headers.cookie);
  const resolved = resolveSession(cookies[SESSION_COOKIE]);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') || '/' : url.pathname;

  const ctx = {
    req,
    res,
    url,
    pathname,
    method: req.method.toUpperCase(),
    query: queryToObject(url.searchParams),
    params: {},
    cookies,
    body: {},
    user: resolved?.user || null,
    session: resolved?.session || null,
    sessionToken: resolved ? cookies[SESSION_COOKIE] : null,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
    isJson: wantsJson(req, pathname),
    flash: null,
  };

  ctx.csrfToken = resolveCsrfToken(ctx);
  ctx.flash = takeFlash(cookies, res);

  /** Render a full page inside the site shell. */
  ctx.render = ({ title, body, activeNav = '', wide = false, status = 200, description }) => {
    const counts = ctx.user
      ? {
          unreadMessages: ctx.user.role === 'admin' ? 0 : unreadMessageCount(ctx.user.id),
          unreadNotifications: unreadCount(ctx.user.id),
        }
      : { unreadMessages: 0, unreadNotifications: 0 };

    sendHtml(
      res,
      layout({
        title,
        body,
        description,
        user: ctx.user,
        activeNav,
        flash: ctx.flash,
        csrfToken: ctx.csrfToken,
        wide,
        ...counts,
      }),
      status
    );
  };

  ctx.json = (data, status = 200) => sendJson(res, data, status);

  /** Redirect, optionally with a one-shot flash message. */
  ctx.redirect = (location, flash = null) => {
    if (flash) setFlash(res, flash);
    sendRedirect(res, location);
  };

  /** Re-render a page after a failed submission, preserving input. */
  ctx.renderWithFlash = (flash, renderOptions) => {
    ctx.flash = flash;
    ctx.render(renderOptions);
  };

  return ctx;
}

function respondWithError(ctx, status, message) {
  if (ctx.isJson) {
    ctx.json({ error: message || 'Request failed.', status }, status);
    return;
  }
  ctx.render({ title: `Error ${status}`, body: errorPage({ status, message, user: ctx.user }), status });
}

function handleFailure(ctx, error) {
  if (error instanceof RedirectError) {
    if (error.flash) setFlash(ctx.res, error.flash);
    sendRedirect(ctx.res, error.location, error.status);
    return;
  }

  if (error instanceof ValidationError) {
    if (ctx.isJson) {
      ctx.json({ error: error.message, fields: error.fieldErrors }, 422);
      return;
    }
    respondWithError(ctx, 422, error.message);
    return;
  }

  if (error instanceof HttpError) {
    respondWithError(ctx, error.status, error.message);
    return;
  }

  logger.fault(error, { path: ctx.pathname, method: ctx.method, user: ctx.user?.id });
  respondWithError(ctx, 500, '');
}

export function createRequestHandler() {
  return async function handle(req, res) {
    const startedAt = process.hrtime.bigint();
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(header, value);
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
      return;
    }

    if (serveStatic(req, res, url.pathname)) return;

    let ctx;
    try {
      ctx = buildContext(req, res, url);
    } catch (error) {
      logger.fault(error, { path: url.pathname });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
      return;
    }

    try {
      const match = router.match(ctx.method, ctx.pathname);

      if (!match) {
        throw new HttpError(404, 'That page could not be found.');
      }
      if (match.allowed) {
        res.setHeader('Allow', match.allowed.join(', '));
        throw new HttpError(405, 'That action is not available on this page.');
      }

      ctx.params = match.params;

      if (UNSAFE_METHODS.has(ctx.method)) {
        ctx.body = await parseBody(req);
        verifyCsrf(ctx);
      }

      for (const step of match.route.chain) {
        // eslint-disable-next-line no-await-in-loop -- guards must run in order
        await step(ctx);
        if (res.writableEnded) break;
      }

      if (!res.writableEnded) {
        throw new HttpError(500, '');
      }
    } catch (error) {
      if (!res.writableEnded) handleFailure(ctx, error);
      else logger.fault(error, { path: ctx.pathname, note: 'after response' });
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', {
        method: ctx.method,
        path: ctx.pathname,
        status: res.statusCode,
        ms: durationMs.toFixed(1),
        user: ctx.user?.id,
      });
    }
  };
}

export function createServer() {
  const server = http.createServer(createRequestHandler());
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  return server;
}

export default createServer;
