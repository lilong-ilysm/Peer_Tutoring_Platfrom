/**
 * Admin console routes. Every mutation is audit-logged.
 */
import { notFound } from '../../lib/errors.js';
import { coerceEnum, coerceString, Validator } from '../../lib/validate.js';
import { listAudit, platformStats, recentBookings, recordAudit } from '../../services/admin.js';
import { revokeSessionsOnSuspension } from '../../services/auth.js';
import { listReviews, setReviewHidden } from '../../services/reviews.js';
import {
  createSubject,
  setSubjectActive,
  subjectsWithTutorCounts,
  updateSubject,
} from '../../services/subjects.js';
import { listUsers, ROLES, setUserStatus } from '../../services/users.js';
import { requireRole } from '../middleware.js';
import {
  adminAuditPage,
  adminOverviewPage,
  adminReviewsPage,
  adminSubjectsPage,
  adminUsersPage,
} from '../views/pages/admin.js';
import { attempt, pageFromQuery } from './helpers.js';

const requireAdmin = requireRole('admin');

export function registerAdminRoutes(router) {
  router.get('/admin', requireAdmin, (ctx) => {
    ctx.render({
      title: 'Admin overview',
      activeNav: 'admin',
      wide: true,
      body: adminOverviewPage({ stats: platformStats(), recent: recentBookings(8) }),
    });
  });

  /* ------------------------------------------------------------- users -- */
  router.get('/admin/users', requireAdmin, (ctx) => {
    const filters = {
      search: coerceString(ctx.query.q, { max: 80 }),
      role: coerceEnum(ctx.query.role, ROLES, '') || '',
      status: coerceEnum(ctx.query.status, ['active', 'suspended'], '') || '',
    };
    const results = listUsers({ ...filters, page: pageFromQuery(ctx.query), pageSize: 20 });

    ctx.render({
      title: 'Users',
      activeNav: 'admin-users',
      wide: true,
      body: adminUsersPage({ results, filters, query: ctx.query, csrfToken: ctx.csrfToken }),
    });
  });

  router.post('/admin/users/:id/suspend', requireAdmin, async (ctx) => {
    const user = await attempt(ctx, '/admin/users', () => setUserStatus(ctx.params.id, 'suspended'));
    if (!user) return;
    revokeSessionsOnSuspension(user.id);
    recordAudit(ctx.user.id, 'user.suspend', {
      targetType: 'user',
      targetId: user.id,
      meta: { email: user.email },
    });
    ctx.redirect('/admin/users', {
      type: 'success',
      message: `${user.full_name} is suspended and has been signed out.`,
    });
  });

  router.post('/admin/users/:id/reinstate', requireAdmin, async (ctx) => {
    const user = await attempt(ctx, '/admin/users', () => setUserStatus(ctx.params.id, 'active'));
    if (!user) return;
    recordAudit(ctx.user.id, 'user.reinstate', {
      targetType: 'user',
      targetId: user.id,
      meta: { email: user.email },
    });
    ctx.redirect('/admin/users', {
      type: 'success',
      message: `${user.full_name} can sign in again.`,
    });
  });

  /* ---------------------------------------------------------- subjects -- */
  router.get('/admin/subjects', requireAdmin, (ctx) => {
    ctx.render({
      title: 'Subjects',
      activeNav: 'admin-subjects',
      wide: true,
      body: adminSubjectsPage({
        subjects: subjectsWithTutorCounts({ activeOnly: false }),
        csrfToken: ctx.csrfToken,
      }),
    });
  });

  router.post('/admin/subjects', requireAdmin, async (ctx) => {
    const v = new Validator(ctx.body);
    const code = v.string('code', {
      required: true,
      min: 2,
      max: 20,
      label: 'Code',
      pattern: /^[A-Za-z0-9][A-Za-z0-9 _-]*$/,
      patternMessage: 'Codes may contain letters, numbers, spaces, hyphens and underscores.',
    });
    const name = v.string('name', { required: true, min: 2, max: 80, label: 'Name' });
    const category = v.string('category', { max: 60, label: 'Category' });

    if (!v.ok) {
      ctx.render({
        title: 'Subjects',
        status: 422,
        activeNav: 'admin-subjects',
        wide: true,
        body: adminSubjectsPage({
          subjects: subjectsWithTutorCounts({ activeOnly: false }),
          csrfToken: ctx.csrfToken,
          values: { code: ctx.body.code, name: ctx.body.name, category: ctx.body.category },
          errors: v.errors,
        }),
      });
      return;
    }

    const subject = await attempt(ctx, '/admin/subjects', () =>
      createSubject({ code, name, category: category || 'General' })
    );
    if (!subject) return;
    recordAudit(ctx.user.id, 'subject.create', {
      targetType: 'subject',
      targetId: subject.id,
      meta: { code: subject.code, name: subject.name },
    });
    ctx.redirect('/admin/subjects', { type: 'success', message: `${subject.name} added.` });
  });

  router.post('/admin/subjects/:id/rename', requireAdmin, async (ctx) => {
    const v = new Validator(ctx.body);
    const name = v.string('name', { required: true, min: 2, max: 80, label: 'Name' });
    const category = v.string('category', { max: 60, label: 'Category' });
    if (!v.ok) {
      ctx.redirect('/admin/subjects', { type: 'error', message: v.errors.name || v.errors.category });
      return;
    }

    const subject = await attempt(ctx, '/admin/subjects', () =>
      updateSubject(ctx.params.id, { name, category: category || 'General' })
    );
    if (!subject) return;
    recordAudit(ctx.user.id, 'subject.update', {
      targetType: 'subject',
      targetId: subject.id,
      meta: { name: subject.name, category: subject.category },
    });
    ctx.redirect('/admin/subjects', { type: 'success', message: `${subject.name} updated.` });
  });

  router.post('/admin/subjects/:id/toggle', requireAdmin, async (ctx) => {
    const subjects = subjectsWithTutorCounts({ activeOnly: false });
    const existing = subjects.find((subject) => subject.id === Number(ctx.params.id));
    if (!existing) throw notFound('Subject not found.');

    const subject = await attempt(ctx, '/admin/subjects', () =>
      setSubjectActive(existing.id, !existing.is_active)
    );
    if (!subject) return;
    recordAudit(ctx.user.id, subject.is_active ? 'subject.restore' : 'subject.retire', {
      targetType: 'subject',
      targetId: subject.id,
      meta: { name: subject.name },
    });
    ctx.redirect('/admin/subjects', {
      type: 'success',
      message: subject.is_active
        ? `${subject.name} is available again.`
        : `${subject.name} is retired and hidden from new selections.`,
    });
  });

  /* ----------------------------------------------------------- reviews -- */
  router.get('/admin/reviews', requireAdmin, (ctx) => {
    ctx.render({
      title: 'Reviews',
      activeNav: 'admin-reviews',
      wide: true,
      body: adminReviewsPage({
        results: listReviews({ page: pageFromQuery(ctx.query), pageSize: 20 }),
        csrfToken: ctx.csrfToken,
      }),
    });
  });

  router.post('/admin/reviews/:id/hide', requireAdmin, async (ctx) => {
    const review = await attempt(ctx, '/admin/reviews', () => setReviewHidden(ctx.params.id, true));
    if (!review) return;
    recordAudit(ctx.user.id, 'review.hide', {
      targetType: 'review',
      targetId: review.id,
      meta: { tutorId: review.tutor_id },
    });
    ctx.redirect('/admin/reviews', {
      type: 'success',
      message: 'Review hidden and the tutor rating recalculated.',
    });
  });

  router.post('/admin/reviews/:id/show', requireAdmin, async (ctx) => {
    const review = await attempt(ctx, '/admin/reviews', () => setReviewHidden(ctx.params.id, false));
    if (!review) return;
    recordAudit(ctx.user.id, 'review.restore', {
      targetType: 'review',
      targetId: review.id,
      meta: { tutorId: review.tutor_id },
    });
    ctx.redirect('/admin/reviews', {
      type: 'success',
      message: 'Review restored and the tutor rating recalculated.',
    });
  });

  /* ------------------------------------------------------------- audit -- */
  router.get('/admin/audit', requireAdmin, (ctx) => {
    ctx.render({
      title: 'Audit log',
      activeNav: 'admin-audit',
      wide: true,
      body: adminAuditPage({ entries: listAudit({ limit: 200 }) }),
    });
  });
}
