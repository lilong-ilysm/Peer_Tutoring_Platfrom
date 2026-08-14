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

// Bump when CSS or the client script changes, so cached assets are replaced.
const ASSET_VERSION = '2';

/**
 * Primary destinations per role.
 *
 * `icon` is used by the mobile bottom bar; `mobile: false` keeps an item out of
 * it so the bar never holds more than four targets. Both navigations are driven
 * from this one list, so they can never drift apart.
 */
function navItems(user) {
  if (!user) {
    return [
      { href: '/', label: 'Home', key: 'home', icon: 'home' },
      { href: '/tutors', label: 'Find tutors', key: 'tutors', icon: 'search' },
      { href: '/login', label: 'Log in', key: 'login', icon: 'user' },
      { href: '/register', label: 'Sign up', key: 'register', icon: 'check' },
    ];
  }
  if (user.role === 'admin') {
    return [
      { href: '/admin', label: 'Overview', key: 'admin', icon: 'home' },
      { href: '/admin/users', label: 'Users', key: 'admin-users', icon: 'users' },
      { href: '/admin/subjects', label: 'Subjects', key: 'admin-subjects', icon: 'inbox' },
      { href: '/admin/reviews', label: 'Reviews', key: 'admin-reviews', icon: 'star' },
      { href: '/admin/audit', label: 'Audit log', key: 'admin-audit', icon: 'clock', mobile: false },
    ];
  }
  if (user.role === 'tutor') {
    return [
      { href: '/dashboard', label: 'Dashboard', key: 'dashboard', icon: 'home' },
      { href: '/bookings', label: 'Sessions', key: 'bookings', icon: 'calendar' },
      { href: '/profile/availability', label: 'Availability', key: 'availability', icon: 'clock' },
      { href: '/messages', label: 'Messages', key: 'messages', icon: 'chat' },
    ];
  }
  return [
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard', icon: 'home' },
    { href: '/tutors', label: 'Find tutors', key: 'tutors', icon: 'search' },
    { href: '/bookings', label: 'Sessions', key: 'bookings', icon: 'calendar' },
    { href: '/messages', label: 'Messages', key: 'messages', icon: 'chat' },
  ];
}

/**
 * Mobile navigation: a fixed bottom bar with icon + label targets.
 *
 * Deliberately not a shrunken desktop row and not a JavaScript drawer - it is
 * always visible, thumb-reachable, needs no script, and cannot overflow because
 * it holds at most four items.
 */
function bottomNav(items, activeNav, unreadMessages) {
  const targets = items.filter((item) => item.mobile !== false).slice(0, 4);
  return html`
    <nav class="bottom-nav" aria-label="Primary">
      ${targets.map(
        (item) => html`<a
          class="${classNames('bottom-nav__link', activeNav === item.key && 'bottom-nav__link--active')}"
          href="${safeUrl(item.href, '/')}"
          ${attrs({ 'aria-current': activeNav === item.key ? 'page' : undefined })}
        >
          <span class="bottom-nav__icon" aria-hidden="true">${icons[item.icon] || icons.inbox}</span>
          <span class="bottom-nav__label">${item.label}</span>
          ${item.key === 'messages' && unreadMessages > 0
            ? html`<span class="bottom-nav__badge" aria-hidden="true">${unreadMessages}</span>
                <span class="sr-only">${unreadMessages} unread</span>`
            : raw('')}
        </a>`
      )}
    </nav>
  `;
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

    ${bottomNav(items, activeNav, unreadMessages)}

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
