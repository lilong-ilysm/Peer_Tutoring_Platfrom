/**
 * Registration, login and logout.
 */
import config from '../../config.js';
import { DomainError } from '../../lib/errors.js';
import { safeNextPath, setCookie, clearCookie } from '../../lib/http.js';
import { limiters } from '../../lib/ratelimit.js';
import { checkPasswordStrength } from '../../lib/security.js';
import { Validator } from '../../lib/validate.js';
import { destroySession, login, register, SESSION_COOKIE } from '../../services/auth.js';
import { SELF_SERVICE_ROLES } from '../../services/users.js';
import { requireAuth, requireGuest } from '../middleware.js';
import { loginPage, registerPage } from '../views/pages/auth.js';
import { enforce, homeFor } from './helpers.js';

function sessionCookieOptions() {
  return {
    maxAge: config.sessionTtlHours * 3600,
    sameSite: 'Lax',
    httpOnly: true,
  };
}

function renderRegister(ctx, { values, errors, status = 200 }) {
  ctx.render({
    title: 'Create an account',
    status,
    body: registerPage({
      values,
      errors,
      csrfToken: ctx.csrfToken,
      next: safeNextPath(ctx.body?.next ?? ctx.query.next, ''),
    }),
  });
}

function renderLogin(ctx, { values, errors, status = 200 }) {
  ctx.render({
    title: 'Log in',
    status,
    body: loginPage({
      values,
      errors,
      csrfToken: ctx.csrfToken,
      next: safeNextPath(ctx.body?.next ?? ctx.query.next, ''),
    }),
  });
}

export function registerAuthRoutes(router) {
  router.get('/register', requireGuest, (ctx) => {
    const role = ctx.query.role === 'tutor' ? 'tutor' : 'student';
    renderRegister(ctx, { values: { role }, errors: {} });
  });

  router.post('/register', requireGuest, (ctx) => {
    enforce(limiters.register, ctx.ip, 'Too many accounts created from here. Try again later.');

    const v = new Validator(ctx.body);
    const fullName = v.string('fullName', { required: true, label: 'Full name', min: 2, max: 80 });
    const email = v.email('email', { required: true, label: 'Email address' });
    const password = v.password('password', { required: true, label: 'Password' });
    const confirmPassword = v.password('confirmPassword', {
      required: true,
      label: 'Password confirmation',
    });
    const role = v.enum('role', SELF_SERVICE_ROLES, { required: true, label: 'Account type' });

    if (password) {
      const weak = checkPasswordStrength(password);
      if (weak) v.fail('password', weak);
      else if (confirmPassword && password !== confirmPassword) {
        v.fail('confirmPassword', 'The two passwords do not match.');
      }
    }

    // Re-render from the raw submission (never the validated value, which is
    // undefined for a rejected field) so nothing the user typed is lost.
    const values = {
      fullName: ctx.body.fullName ?? fullName ?? '',
      email: ctx.body.email ?? email ?? '',
      role: role || (ctx.body.role === 'tutor' ? 'tutor' : 'student'),
    };
    if (!v.ok) {
      renderRegister(ctx, { values, errors: v.errors, status: 422 });
      return;
    }

    let created;
    try {
      created = register({
        email,
        password,
        fullName,
        role,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        const field = error.code === 'email_taken' ? 'email' : 'password';
        renderRegister(ctx, { values, errors: { [field]: error.message }, status: 422 });
        return;
      }
      throw error;
    }

    setCookie(ctx.res, SESSION_COOKIE, created.token, sessionCookieOptions());

    const next = safeNextPath(ctx.body.next, '');
    if (role === 'tutor') {
      ctx.redirect(next || '/profile', {
        type: 'success',
        message:
          'Account created. Add a headline, your subjects and weekly hours, then publish to appear in search.',
      });
      return;
    }
    ctx.redirect(next || '/dashboard', {
      type: 'success',
      message: `Welcome to ${config.appName}, ${fullName.split(' ')[0]}. Find a tutor to get started.`,
    });
  });

  router.get('/login', requireGuest, (ctx) => {
    renderLogin(ctx, { values: {}, errors: {} });
  });

  router.post('/login', requireGuest, (ctx) => {
    const limitKey = `${ctx.ip}`;
    enforce(
      limiters.login,
      limitKey,
      'Too many sign-in attempts from here. Wait a few minutes and try again.'
    );

    const v = new Validator(ctx.body);
    const email = v.email('email', { required: true, label: 'Email address' });
    const password = v.password('password', { required: true, label: 'Password' });
    const typedEmail = typeof ctx.body.email === 'string' ? ctx.body.email : email || '';

    if (!v.ok) {
      renderLogin(ctx, { values: { email: typedEmail }, errors: v.errors, status: 422 });
      return;
    }

    let result;
    try {
      result = login({ email, password, ip: ctx.ip, userAgent: ctx.userAgent });
    } catch (error) {
      if (error instanceof DomainError) {
        renderLogin(ctx, {
          values: { email: typedEmail },
          errors: { email: error.message },
          status: error.status === 403 ? 403 : 401,
        });
        return;
      }
      throw error;
    }

    limiters.login.reset(limitKey);
    setCookie(ctx.res, SESSION_COOKIE, result.token, sessionCookieOptions());

    const next = safeNextPath(ctx.body.next, homeFor(result.user));
    ctx.redirect(next, {
      type: 'success',
      message: `Signed in as ${result.user.full_name.split(' ')[0]}.`,
    });
  });

  router.post('/logout', requireAuth, (ctx) => {
    destroySession(ctx.sessionToken);
    clearCookie(ctx.res, SESSION_COOKIE);
    ctx.redirect('/', { type: 'success', message: 'You are signed out.' });
  });
}
