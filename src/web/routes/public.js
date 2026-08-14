/**
 * Public pages: landing, tutor search, tutor profile.
 */
import config from '../../config.js';
import { notFound } from '../../lib/errors.js';
import { coerceEnum, coerceFloat, coerceInt, coerceString } from '../../lib/validate.js';
import { platformStats } from '../../services/admin.js';
import { blocksByWeekday, generateSlots, groupSlotsByDay } from '../../services/availability.js';
import { listReviewsForTutor } from '../../services/reviews.js';
import { subjectsWithTutorCounts } from '../../services/subjects.js';
import {
  featuredTutors,
  getPublicTutor,
  searchTutors,
  SORT_OPTIONS,
  SUBJECT_LEVELS,
} from '../../services/tutors.js';
import { landingPage } from '../views/pages/landing.js';
import { tutorProfilePage, tutorSearchPage } from '../views/pages/tutors.js';
import { pageFromQuery } from './helpers.js';

/** Coerce query-string filters. Junk values are ignored, never fatal (AC-21). */
function readFilters(query) {
  return {
    q: coerceString(query.q, { max: 80 }),
    subjectId: coerceInt(query.subject, null, { min: 1, max: 1e9 }),
    level: coerceEnum(query.level, SUBJECT_LEVELS, null),
    mode: coerceEnum(query.mode, ['online', 'in_person'], null),
    minRating: coerceFloat(query.rating, null, { min: 0, max: 5 }),
    maxRate: coerceInt(query.maxRate, null, { min: 0, max: 100000 }),
    weekday: coerceInt(query.day, null, { min: 0, max: 6 }),
    sort: coerceEnum(query.sort, SORT_OPTIONS, 'rating'),
    page: pageFromQuery(query),
  };
}

export function registerPublicRoutes(router) {
  router.get('/', (ctx) => {
    if (ctx.user) {
      ctx.redirect(ctx.user.role === 'admin' ? '/admin' : '/dashboard');
      return;
    }
    const stats = platformStats();
    ctx.render({
      title: 'Peer tutoring for students, by students',
      activeNav: 'home',
      body: landingPage({
        stats: {
          tutors: stats.tutorsPublished,
          subjects: stats.subjects,
          completedSessions: stats.bookings.completed,
        },
        featured: featuredTutors(3),
        subjects: subjectsWithTutorCounts(),
      }),
    });
  });

  router.get('/tutors', (ctx) => {
    const filters = readFilters(ctx.query);
    const results = searchTutors({
      q: filters.q,
      subjectId: filters.subjectId,
      level: filters.level,
      mode: filters.mode,
      minRating: filters.minRating,
      maxRateCents: filters.maxRate === null ? null : filters.maxRate * 100,
      weekday: filters.weekday,
      sort: filters.sort,
      page: filters.page,
      pageSize: config.limits.pageSize,
    });

    ctx.render({
      title: 'Find a tutor',
      activeNav: 'tutors',
      wide: true,
      body: tutorSearchPage({
        filters,
        results,
        subjects: subjectsWithTutorCounts(),
        query: ctx.query,
      }),
    });
  });

  router.get('/tutors/:id', (ctx) => {
    const tutor = getPublicTutor(ctx.params.id);
    if (!tutor) throw notFound('That tutor profile is not available.');

    const viewerIsOwner = Boolean(ctx.user && ctx.user.id === tutor.id);
    const viewerIsAdmin = ctx.user?.role === 'admin';
    const publiclyVisible = Boolean(tutor.is_published) && tutor.status === 'active';

    // An unpublished or suspended profile is invisible to everyone except its
    // owner and administrators - 404 rather than 403 so nothing is disclosed.
    if (!publiclyVisible && !viewerIsOwner && !viewerIsAdmin) {
      throw notFound('That tutor profile is not available.');
    }

    const slots = generateSlots(tutor.id);
    ctx.render({
      title: tutor.full_name,
      description: tutor.headline || `Peer tutor profile for ${tutor.full_name}`,
      activeNav: 'tutors',
      body: tutorProfilePage({
        tutor,
        slotDays: groupSlotsByDay(slots),
        reviews: listReviewsForTutor(tutor.id, { limit: 20 }),
        weeklyBlocks: blocksByWeekday(tutor.id),
        viewer: ctx.user,
        canBook: Boolean(
          ctx.user && ctx.user.role === 'student' && ctx.user.id !== tutor.id && tutor.is_published
        ),
        csrfToken: ctx.csrfToken,
      }),
    });
  });
}
