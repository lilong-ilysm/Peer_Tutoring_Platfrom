/**
 * Booking flow: request, list, detail, accept, decline, cancel, review.
 */
import config from '../../config.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { limiters } from '../../lib/ratelimit.js';
import { coerceEnum, Validator } from '../../lib/validate.js';
import { findSlot } from '../../services/availability.js';
import {
  acceptBooking,
  bookingCountsFor,
  bookingTimeline,
  cancelBooking,
  createBooking,
  declineBooking,
  getBookingForUser,
  listBookingsForUser,
} from '../../services/bookings.js';
import { findConversation } from '../../services/messages.js';
import { createReview, getReviewByBooking } from '../../services/reviews.js';
import { getPublicTutor, listTutorSubjects } from '../../services/tutors.js';
import { requireAuth, requireRole } from '../middleware.js';
import { bookingDetailPage, bookingsPage } from '../views/pages/bookings.js';
import { bookingRequestPage } from '../views/pages/tutors.js';
import { attempt, enforce, pageFromQuery } from './helpers.js';

const requireStudent = requireRole('student');
const requireTutor = requireRole('tutor');
const requireParticipantRole = requireRole('student', 'tutor');

/** Tutor for a booking request, validated for bookability. */
function loadBookableTutor(id) {
  const tutor = getPublicTutor(id);
  if (!tutor || !tutor.is_published || tutor.status !== 'active') {
    throw notFound('That tutor is not taking bookings.');
  }
  return tutor;
}

export function registerBookingRoutes(router) {
  /* ----------------------------------------------------------- list ----- */
  router.get('/bookings', requireParticipantRole, (ctx) => {
    const scope = coerceEnum(ctx.query.scope, ['upcoming', 'pending', 'past', 'all'], 'upcoming');
    const results = listBookingsForUser(ctx.user, { scope, page: pageFromQuery(ctx.query) });

    ctx.render({
      title: 'Sessions',
      activeNav: 'bookings',
      body: bookingsPage({
        viewer: ctx.user,
        scope,
        results,
        csrfToken: ctx.csrfToken,
        counts: bookingCountsFor(ctx.user),
      }),
    });
  });

  /* -------------------------------------------------------- new form ---- */
  router.get('/bookings/new', requireStudent, (ctx) => {
    const tutor = loadBookableTutor(ctx.query.tutor);
    if (tutor.id === ctx.user.id) throw badRequest('You cannot book a session with yourself.');

    const slotStart = Array.isArray(ctx.query.slot) ? ctx.query.slot[0] : ctx.query.slot;
    const slot = findSlot(tutor.id, String(slotStart || ''));
    if (!slot) {
      ctx.redirect(`/tutors/${tutor.id}#availability`, {
        type: 'error',
        message: 'That time is no longer available. Please choose another slot.',
      });
      return;
    }

    const subjects = listTutorSubjects(tutor.id).filter((subject) => subject.is_active);
    if (subjects.length === 0) {
      ctx.redirect(`/tutors/${tutor.id}`, {
        type: 'error',
        message: 'This tutor has no bookable subjects at the moment.',
      });
      return;
    }

    ctx.render({
      title: 'Request a session',
      activeNav: 'tutors',
      body: bookingRequestPage({
        tutor,
        slot,
        subjectOptions: subjects.map((subject) => ({
          value: subject.subject_id,
          label: `${subject.name} (${subject.code})`,
        })),
        values: {},
        errors: {},
        csrfToken: ctx.csrfToken,
      }),
    });
  });

  /* ---------------------------------------------------------- create ---- */
  router.post('/bookings', requireStudent, async (ctx) => {
    enforce(limiters.booking, `${ctx.user.id}`, 'Too many booking attempts. Wait a moment.');

    const tutor = loadBookableTutor(ctx.body.tutorId);
    const v = new Validator(ctx.body);
    const startsAt = v.isoDateTime('startsAt', { required: true, label: 'Session time' });
    const subjectId = v.int('subjectId', { required: true, label: 'Subject', min: 1 });
    const mode = tutor.mode === 'both' ? v.enum('mode', ['online', 'in_person'], { required: true, label: 'Session mode' }) : tutor.mode;
    const note = v.text('note', { max: config.limits.noteLength, label: 'Note' });

    if (!v.ok) {
      const slot = findSlot(tutor.id, String(ctx.body.startsAt || ''));
      if (!slot) {
        ctx.redirect(`/tutors/${tutor.id}#availability`, {
          type: 'error',
          message: 'That time is no longer available. Please choose another slot.',
        });
        return;
      }
      ctx.render({
        title: 'Request a session',
        status: 422,
        activeNav: 'tutors',
        body: bookingRequestPage({
          tutor,
          slot,
          subjectOptions: listTutorSubjects(tutor.id)
            .filter((subject) => subject.is_active)
            .map((subject) => ({
              value: subject.subject_id,
              label: `${subject.name} (${subject.code})`,
            })),
          values: { subjectId: ctx.body.subjectId, mode: ctx.body.mode, note: ctx.body.note },
          errors: v.errors,
          csrfToken: ctx.csrfToken,
        }),
      });
      return;
    }

    const booking = await attempt(ctx, `/tutors/${tutor.id}#availability`, () =>
      createBooking({
        studentId: ctx.user.id,
        tutorId: tutor.id,
        subjectId,
        startsAt,
        mode,
        note,
      })
    );
    if (!booking) return;

    ctx.redirect(`/bookings/${booking.id}`, {
      type: 'success',
      message: `Request sent to ${tutor.full_name}. You will be notified when they respond.`,
    });
  });

  /* ---------------------------------------------------------- detail ---- */
  router.get('/bookings/:id', requireAuth, (ctx) => {
    const booking = getBookingForUser(ctx.params.id, ctx.user);
    if (!booking) throw notFound('That session could not be found.');

    // Link to an existing thread if there is one; never create one here.
    const conversation =
      ctx.user.role === 'admin' ? null : findConversation(booking.student_id, booking.tutor_id);

    ctx.render({
      title: `${booking.subject_name} session`,
      activeNav: 'bookings',
      body: bookingDetailPage({
        booking,
        viewer: ctx.user,
        csrfToken: ctx.csrfToken,
        timeline: bookingTimeline(booking),
        review: getReviewByBooking(booking.id),
        conversationId: conversation?.id || null,
      }),
    });
  });

  /* ----------------------------------------------------- transitions ---- */
  router.post('/bookings/:id/accept', requireTutor, async (ctx) => {
    const target = `/bookings/${encodeURIComponent(ctx.params.id)}`;
    const booking = await attempt(ctx, target, () => acceptBooking(ctx.params.id, ctx.user));
    if (!booking) return;
    ctx.redirect(target, {
      type: 'success',
      message: `Session confirmed. ${booking.student_name} has been notified.`,
    });
  });

  router.post('/bookings/:id/decline', requireTutor, async (ctx) => {
    const target = `/bookings/${encodeURIComponent(ctx.params.id)}`;
    const v = new Validator(ctx.body);
    const note = v.text('note', { max: config.limits.noteLength, label: 'Reason' });
    const booking = await attempt(ctx, target, () => declineBooking(ctx.params.id, ctx.user, note));
    if (!booking) return;
    ctx.redirect(target, {
      type: 'success',
      message: 'Request declined and the student has been notified.',
    });
  });

  router.post('/bookings/:id/cancel', requireParticipantRole, async (ctx) => {
    const target = `/bookings/${encodeURIComponent(ctx.params.id)}`;
    const v = new Validator(ctx.body);
    const reason = v.text('reason', {
      required: true,
      min: 3,
      max: config.limits.noteLength,
      label: 'Reason',
    });
    if (!v.ok) {
      ctx.redirect(target, { type: 'error', message: v.errors.reason });
      return;
    }
    const booking = await attempt(ctx, target, () => cancelBooking(ctx.params.id, ctx.user, reason));
    if (!booking) return;
    ctx.redirect(target, {
      type: 'success',
      message: 'Session cancelled. The other person has been notified.',
    });
  });

  /* --------------------------------------------------------- reviews ---- */
  router.post('/bookings/:id/review', requireStudent, async (ctx) => {
    const target = `/bookings/${encodeURIComponent(ctx.params.id)}`;
    enforce(limiters.review, `${ctx.user.id}`, 'Too many reviews submitted. Try again later.');

    const v = new Validator(ctx.body);
    const rating = v.int('rating', { required: true, min: 1, max: 5, label: 'Rating' });
    const comment = v.text('comment', { max: config.limits.reviewLength, label: 'Comment' });
    if (!v.ok) {
      ctx.redirect(`${target}#review`, {
        type: 'error',
        message: v.errors.rating || v.errors.comment,
      });
      return;
    }

    const review = await attempt(ctx, `${target}#review`, () =>
      createReview({ bookingId: ctx.params.id, studentId: ctx.user.id, rating, comment })
    );
    if (!review) return;

    ctx.redirect(target, {
      type: 'success',
      message: 'Thanks - your review is published on the tutor’s profile.',
    });
  });
}


