/**
 * Admin console: overview, users, subjects, review moderation, audit log.
 *
 * Tables carry `data-label` attributes so they can restack as readable rows on
 * a phone instead of scrolling sideways (spec 5.3).
 */
import {
  badge,
  csrfField,
  emptyState,
  errorSummary,
  pageHeader,
  pagination,
  selectField,
  statTile,
  statusBadge,
  submitButton,
  textField,
  timeTag,
} from '../components.js';
import { html, join, queryString, raw } from '../html.js';

export function adminOverviewPage({ stats, recent }) {
  return html`
    ${pageHeader({
      title: 'Platform overview',
      subtitle: 'Health of the tutoring programme at a glance.',
    })}

    <div class="grid grid--4 section">
      ${statTile({ label: 'Accounts', value: stats.users.total, href: '/admin/users' })}
      ${statTile({ label: 'Published tutors', value: stats.tutorsPublished, tone: 'success' })}
      ${statTile({ label: 'Suspended accounts', value: stats.users.suspended, tone: 'warning', href: '/admin/users?status=suspended' })}
      ${statTile({ label: 'Active subjects', value: stats.subjects, href: '/admin/subjects' })}
    </div>

    <div class="grid grid--4 section">
      ${statTile({ label: 'Sessions total', value: stats.bookings.total })}
      ${statTile({ label: 'Pending requests', value: stats.bookings.pending, tone: 'warning' })}
      ${statTile({ label: 'Completed sessions', value: stats.bookings.completed, tone: 'success' })}
      ${statTile({
        label: 'Reviews',
        value: stats.reviews.total,
        hint: stats.reviews.average ? `Average ${stats.reviews.average} of 5` : 'No ratings yet',
        href: '/admin/reviews',
      })}
    </div>

    <section class="card card--flush">
      <div class="card__head card__head--flush">
        <h2 class="card__title">Recent sessions</h2>
      </div>
      ${recent.length === 0
        ? emptyState({
            icon: 'calendar',
            title: 'No sessions yet',
            message: 'Booking activity will appear here as students start requesting sessions.',
          })
        : html`<div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Student</th>
                  <th scope="col">Tutor</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                ${recent.map(
                  (booking) => html`<tr>
                    <td data-label="Subject">
                      <a href="/bookings/${booking.id}">${booking.subject_name}</a>
                    </td>
                    <td data-label="Student">${booking.student_name}</td>
                    <td data-label="Tutor">${booking.tutor_name}</td>
                    <td data-label="When">${timeTag(booking.starts_at)}</td>
                    <td data-label="Status">${statusBadge(booking.status)}</td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`}
    </section>
  `;
}

export function adminUsersPage({ results, filters, query, csrfToken }) {
  const buildHref = (page) => `/admin/users${queryString({ ...query, page })}`;

  return html`
    ${pageHeader({
      title: 'Users',
      subtitle: `${results.total} ${results.total === 1 ? 'account' : 'accounts'} match.`,
    })}

    <form class="filter-bar" method="get" action="/admin/users" data-autosubmit>
      ${textField({ name: 'q', label: 'Search', value: filters.search, maxlength: 80, placeholder: 'Name or email' })}
      ${selectField({
        name: 'role',
        label: 'Role',
        value: filters.role,
        placeholder: 'Any role',
        options: [
          { value: 'student', label: 'Students' },
          { value: 'tutor', label: 'Tutors' },
          { value: 'admin', label: 'Administrators' },
        ],
      })}
      ${selectField({
        name: 'status',
        label: 'Status',
        value: filters.status,
        placeholder: 'Any status',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'suspended', label: 'Suspended' },
        ],
      })}
      ${submitButton('Search', { variant: 'secondary' })}
      <a class="btn btn--ghost btn--sm" href="/admin/users">Reset</a>
    </form>

    <section class="card card--flush">
      ${results.rows.length === 0
        ? emptyState({
            icon: 'users',
            title: 'No accounts match',
            message: 'Try a different search term or clear the filters.',
          })
        : html`<div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${results.rows.map(
                  (user) => html`<tr>
                    <td data-label="Name">
                      ${user.role === 'tutor'
                        ? html`<a href="/tutors/${user.id}">${user.full_name}</a>`
                        : html`${user.full_name}`}
                    </td>
                    <td data-label="Email">${user.email}</td>
                    <td data-label="Role">${badge(user.role, 'neutral')}</td>
                    <td data-label="Status">${statusBadge(user.status)}</td>
                    <td data-label="Joined">${timeTag(user.created_at)}</td>
                    <td data-label="Actions">
                      ${user.role === 'admin'
                        ? html`<span class="text-sm muted">Protected</span>`
                        : user.status === 'active'
                          ? html`<form method="post" action="/admin/users/${user.id}/suspend">
                              ${csrfField(csrfToken)}
                              ${submitButton('Suspend', { variant: 'danger', className: 'btn--sm' })}
                            </form>`
                          : html`<form method="post" action="/admin/users/${user.id}/reinstate">
                              ${csrfField(csrfToken)}
                              ${submitButton('Reinstate', { variant: 'secondary', className: 'btn--sm' })}
                            </form>`}
                    </td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`}
    </section>

    ${pagination({ page: results.page, totalPages: results.totalPages, buildHref, label: 'Users' })}
    <p class="text-sm muted">
      Suspending an account blocks sign-in and ends any active session immediately.
    </p>
  `;
}

export function adminSubjectsPage({ subjects, csrfToken, values = {}, errors = {} }) {
  return html`
    ${pageHeader({
      title: 'Subjects',
      subtitle: 'The catalogue every tutor and search filter draws from.',
    })}

    <div class="split">
      <section class="card card--flush">
        <div class="card__head card__head--flush">
          <h2 class="card__title">Catalogue</h2>
        </div>
        ${subjects.length === 0
          ? emptyState({
              icon: 'inbox',
              title: 'No subjects yet',
              message: 'Add the first subject so tutors have something to teach.',
            })
          : html`<div class="table-wrap">
              <table class="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Category</th>
                    <th scope="col">Tutors</th>
                    <th scope="col">State</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${subjects.map(
                    (subject) => html`<tr>
                      <td data-label="Code"><code>${subject.code}</code></td>
                      <td data-label="Name">${subject.name}</td>
                      <td data-label="Category">${subject.category}</td>
                      <td data-label="Tutors">${subject.tutor_count ?? 0}</td>
                      <td data-label="State">
                        ${subject.is_active ? badge('Active', 'success') : badge('Retired', 'warning')}
                      </td>
                      <td data-label="Actions">
                        <div class="table__actions">
                          <form method="post" action="/admin/subjects/${subject.id}/toggle">
                            ${csrfField(csrfToken)}
                            ${submitButton(subject.is_active ? 'Retire' : 'Restore', {
                              variant: subject.is_active ? 'danger' : 'secondary',
                              className: 'btn--sm',
                            })}
                          </form>
                        </div>
                        <details class="reason-form">
                          <summary>Rename</summary>
                          <form method="post" action="/admin/subjects/${subject.id}/rename">
                            ${csrfField(csrfToken)}
                            <div class="field">
                              <label class="field__label" for="subject-name-${subject.id}">Name</label>
                              <input
                                class="input"
                                id="subject-name-${subject.id}"
                                name="name"
                                type="text"
                                value="${subject.name}"
                                maxlength="80"
                                required
                              />
                            </div>
                            <div class="field">
                              <label class="field__label" for="subject-category-${subject.id}"
                                >Category</label
                              >
                              <input
                                class="input"
                                id="subject-category-${subject.id}"
                                name="category"
                                type="text"
                                value="${subject.category}"
                                maxlength="60"
                              />
                            </div>
                            ${submitButton('Save', { variant: 'primary', className: 'btn--sm' })}
                          </form>
                        </details>
                      </td>
                    </tr>`
                  )}
                </tbody>
              </table>
            </div>`}
      </section>

      <section class="card">
        <h2 class="card__title">Add a subject</h2>
        ${errorSummary(errors)}
        <form class="form" method="post" action="/admin/subjects" novalidate>
          ${csrfField(csrfToken)}
          ${textField({
            name: 'code',
            label: 'Code',
            value: values.code || '',
            required: true,
            maxlength: 20,
            placeholder: 'e.g. MAT101',
            help: 'Short unique identifier, usually the module code.',
            error: errors.code,
          })}
          ${textField({
            name: 'name',
            label: 'Name',
            value: values.name || '',
            required: true,
            maxlength: 80,
            placeholder: 'e.g. Calculus I',
            error: errors.name,
          })}
          ${textField({
            name: 'category',
            label: 'Category',
            value: values.category || '',
            maxlength: 60,
            placeholder: 'e.g. Mathematics',
            error: errors.category,
          })}
          ${submitButton('Add subject')}
        </form>
        <p class="text-sm muted">
          Retiring a subject hides it from new selections but keeps existing sessions intact.
        </p>
      </section>
    </div>
  `;
}

export function adminReviewsPage({ results, csrfToken }) {
  const buildHref = (page) => `/admin/reviews${queryString({ page })}`;

  return html`
    ${pageHeader({
      title: 'Reviews',
      subtitle: 'Hide a review that breaks the code of conduct. Ratings recalculate immediately.',
    })}

    <section class="card card--flush">
      ${results.rows.length === 0
        ? emptyState({
            icon: 'star',
            title: 'No reviews yet',
            message: 'Reviews appear once students complete sessions.',
          })
        : html`<div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Tutor</th>
                  <th scope="col">Student</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Comment</th>
                  <th scope="col">When</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${results.rows.map(
                  (review) => html`<tr>
                    <td data-label="Tutor"><a href="/tutors/${review.tutor_id}">${review.tutor_name}</a></td>
                    <td data-label="Student">${review.student_name}</td>
                    <td data-label="Rating">${badge(`${review.rating} of 5`, 'brand')}</td>
                    <td data-label="Comment">${review.comment || '—'}</td>
                    <td data-label="When">${timeTag(review.created_at)}</td>
                    <td data-label="Actions">
                      ${review.is_hidden
                        ? html`<form method="post" action="/admin/reviews/${review.id}/show">
                            ${csrfField(csrfToken)}
                            ${submitButton('Restore', { variant: 'secondary', className: 'btn--sm' })}
                          </form>`
                        : html`<form method="post" action="/admin/reviews/${review.id}/hide">
                            ${csrfField(csrfToken)}
                            ${submitButton('Hide', { variant: 'danger', className: 'btn--sm' })}
                          </form>`}
                      ${review.is_hidden ? badge('Hidden', 'warning') : raw('')}
                    </td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`}
    </section>

    ${pagination({ page: results.page, totalPages: results.totalPages, buildHref, label: 'Reviews' })}
  `;
}

export function adminAuditPage({ entries }) {
  return html`
    ${pageHeader({
      title: 'Audit log',
      subtitle: 'Every administrative action, most recent first.',
    })}

    <section class="card card--flush">
      ${entries.length === 0
        ? emptyState({
            icon: 'check',
            title: 'Nothing logged yet',
            message: 'Administrative actions such as suspensions and subject changes appear here.',
          })
        : html`<div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Administrator</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                ${entries.map(
                  (entry) => html`<tr>
                    <td data-label="When">${timeTag(entry.created_at)}</td>
                    <td data-label="Administrator">${entry.actor_name || 'System'}</td>
                    <td data-label="Action"><code>${entry.action}</code></td>
                    <td data-label="Target">${entry.target_type} ${entry.target_id}</td>
                    <td data-label="Details">${entry.meta || '—'}</td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`}
    </section>
  `;
}
