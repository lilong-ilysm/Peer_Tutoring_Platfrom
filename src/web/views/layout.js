/**
 * Page shell: document head, header/navigation, flash area, footer.
 *
 * Navigation is always visible and wraps on narrow screens rather than hiding
 * behind a JavaScript toggle, so it works with scripting disabled and cannot
 * trap a keyboard user. Secondary account actions live in a native <details>
 * disclosure, which is keyboard accessible without any script.
 */
import config from '../../config.js';
import { timezoneLabel } from '../../lib/time.js';
import { alert, avatar, icons } from './components.js';
import { attrs, classNames, html, raw, safeUrl } from './html.js';

const ASSET_VERSION = '1';

function navItems(user) {
  if (!user) {
    return [
      { href: '/tutors', label: 'Find tutors', key: 'tutors' },
      { href: '/#how-it-works', label: 'How it works', key: 'how' },
    ];
  }
  if (user.role === 'admin') {
    return [
      { href: '/admin', label: 'Overview', key: 'admin' },
      { href: '/admin/users', label: 'Users', key: 'admin-users' },
      { href: '/admin/subjects', label: 'Subjects', key: 'admin-subjects' },
      { href: '/admin/reviews', label: 'Reviews', key: 'admin-reviews' },
      { href: '/admin/audit', label: 'Audit log', key: 'admin-audit' },
    ];
  }
  if (user.role === 'tutor') {
    return [
      { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
      { href: '/bookings', label: 'Sessions', key: 'bookings' },
      { href: '/profile/availability', label: 'Availability', key: 'availability' },
      { href: '/messages', label: 'Messages', key: 'messages' },
    ];
  }
  return [
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
    { href: '/tutors', label: 'Find tutors', key: 'tutors' },
    { href: '/bookings', label: 'Sessions', key: 'bookings' },
    { href: '/messages', label: 'Messages', key: 'messages' },
  ];
}

function accountMenu(user, csrfToken) {
  const links = [{ href: '/profile', label: 'Profile settings' }];
  if (user.role === 'tutor') {
    links.push({ href: '/profile/subjects', label: 'My subjects' });
    links.push({ href: '/profile/availability', label: 'My availability' });
  }
  links.push({ href: '/notifications', label: 'Notifications' });

  return html`
    <details class="menu">
      <summary class="menu__trigger">
        ${avatar(user.full_name, { size: 'sm', id: user.id })}
        <span class="menu__name">${user.full_name.split(' ')[0]}</span>
        <span class="menu__caret" aria-hidden="true">▾</span>
        <span class="sr-only">Account menu</span>
      </summary>
      <div class="menu__panel">
        <p class="menu__meta">
          <span class="menu__meta-name">${user.full_name}</span>
          <span class="menu__meta-role">${user.role}</span>
        </p>
        <ul class="menu__list">
          ${links.map(
            (link) => html`<li><a class="menu__item" href="${safeUrl(link.href, '/')}">${link.label}</a></li>`
          )}
        </ul>
        <form class="menu__form" method="post" action="/logout">
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <button class="menu__item menu__item--button" type="submit">Log out</button>
        </form>
      </div>
    </details>
  `;
}

/**
 * @param {{
 *   title:string, body:any, description?:string, user?:object|null,
 *   activeNav?:string, flash?:object|null, csrfToken?:string,
 *   unreadMessages?:number, unreadNotifications?:number, wide?:boolean,
 *   bare?:boolean
 * }} options
 */
export function layout({
  title,
  body,
  description = 'Find a peer tutor on campus, book a session and get unstuck.',
  user = null,
  activeNav = '',
  flash = null,
  csrfToken = '',
  unreadMessages = 0,
  unreadNotifications = 0,
  wide = false,
}) {
  const items = navItems(user);
  const pageTitle = `${title} | ${config.appName}`;

  return raw(`<!doctype html>
<html lang="en">
${
  html`<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${description}" />
    <meta name="color-scheme" content="light" />
    ${csrfToken ? html`<meta name="csrf-token" content="${csrfToken}" />` : raw('')}
    <link rel="stylesheet" href="/css/styles.css?v=${ASSET_VERSION}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script src="/js/app.js?v=${ASSET_VERSION}" defer></script>
  </head>`
}
${
  html`<body>
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="${user ? '/dashboard' : '/'}">
          <span class="brand__mark" aria-hidden="true">PL</span>
          <span class="brand__name">${config.appName}</span>
        </a>

        <nav class="site-nav" aria-label="Main navigation">
          <ul class="site-nav__list">
            ${items.map(
              (item) => html`<li>
                <a
                  class="${classNames('site-nav__link', activeNav === item.key && 'site-nav__link--active')}"
                  href="${safeUrl(item.href, '/')}"
                  ${attrs({ 'aria-current': activeNav === item.key ? 'page' : undefined })}
                  >${item.label}${item.key === 'messages' && unreadMessages > 0
                    ? html` <span class="pill" aria-label="${unreadMessages} unread">${unreadMessages}</span>`
                    : raw('')}</a
                >
              </li>`
            )}
          </ul>
        </nav>

        <div class="site-header__end">
          ${user
            ? html`
                <a
                  class="icon-button"
                  href="/notifications"
                  data-notification-link
                  aria-label="${unreadNotifications > 0
                    ? `Notifications: ${unreadNotifications} unread`
                    : 'Notifications: none unread'}"
                >
                  <span class="icon-button__icon" aria-hidden="true">${icons.bell}</span>
                  <span
                    class="${classNames('icon-button__badge', unreadNotifications === 0 && 'is-hidden')}"
                    data-notification-badge
                    aria-hidden="true"
                    >${unreadNotifications}</span
                  >
                </a>
                ${accountMenu(user, csrfToken)}
              `
            : html`
                <a class="btn btn--ghost btn--sm" href="/login">Log in</a>
                <a class="btn btn--primary btn--sm" href="/register">Sign up</a>
              `}
        </div>
      </div>
    </header>

    <main class="${classNames('main', wide && 'main--wide')}" id="main">
      <div class="flash-area" aria-live="polite">${alert(flash)}</div>
      ${body}
    </main>

    <footer class="site-footer">
      <div class="site-footer__inner">
        <p class="site-footer__brand">${config.appName}</p>
        <p class="site-footer__note">
          Peer tutoring for students, by students. All times shown in
          <strong>${timezoneLabel()}</strong>. No payments are processed on this platform.
        </p>
        <ul class="site-footer__links">
          <li><a href="/tutors">Find tutors</a></li>
          <li><a href="/register">Become a tutor</a></li>
          <li><a href="/login">Log in</a></li>
        </ul>
      </div>
    </footer>
  </body>`
}
</html>`);
}

export default layout;
