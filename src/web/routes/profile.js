/**
 * Profile settings, tutor subjects and availability management.
 */
import config from '../../config.js';
import { DomainError } from '../../lib/errors.js';
import { limiters } from '../../lib/ratelimit.js';
import { minutesToTime } from '../../lib/time.js';
import { Validator } from '../../lib/validate.js';
import { changePassword } from '../../services/auth.js';
import {
  addBlock,
  addTimeOff,
  blocksByWeekday,
  generateSlots,
  listTimeOff,
  removeBlock,
  removeTimeOff,
} from '../../services/availability.js';
import { listSubjects } from '../../services/subjects.js';
import {
  addTutorSubject,
  getTutorProfile,
  listTutorSubjects,
  publishRequirements,
  removeTutorSubject,
  saveTutorProfile,
  setPublished,
  SUBJECT_LEVELS,
  TUTOR_MODES,
} from '../../services/tutors.js';
import { getStudentProfile, saveStudentProfile, updateAccount } from '../../services/users.js';
import { requireAuth, requireRole } from '../middleware.js';
import {
  availabilityPage,
  studentProfilePage,
  tutorProfileSettingsPage,
  tutorSubjectsPage,
} from '../views/pages/profile.js';
import { attempt, enforce } from './helpers.js';

const requireTutor = requireRole('tutor');
const requireStudent = requireRole('student');

function renderProfile(ctx, { values = {}, errors = {}, passwordErrors = {}, status = 200 } = {}) {
  if (ctx.user.role === 'tutor') {
    ctx.render({
      title: 'Profile settings',
      status,
      activeNav: 'profile',
      body: tutorProfileSettingsPage({
        viewer: ctx.user,
        profile: getTutorProfile(ctx.user.id),
        requirements: publishRequirements(ctx.user.id),
        values,
        errors,
        passwordErrors,
        csrfToken: ctx.csrfToken,
      }),
    });
    return;
  }
  ctx.render({
    title: 'Profile settings',
    status,
    activeNav: 'profile',
    body: studentProfilePage({
      viewer: ctx.user,
      profile: getStudentProfile(ctx.user.id),
      values,
      errors,
      passwordErrors,
      csrfToken: ctx.csrfToken,
    }),
  });
}

function renderAvailability(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  ctx.render({
    title: 'My availability',
    status,
    activeNav: 'availability',
    body: availabilityPage({
      weeklyBlocks: blocksByWeekday(ctx.user.id),
      timeOff: listTimeOff(ctx.user.id),
      requirements: publishRequirements(ctx.user.id),
      slotCount: generateSlots(ctx.user.id).length,
      csrfToken: ctx.csrfToken,
      values,
      errors,
    }),
  });
}

function renderSubjects(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  ctx.render({
    title: 'My subjects',
    status,
    activeNav: 'profile',
    body: tutorSubjectsPage({
      mine: listTutorSubjects(ctx.user.id),
      catalogue: listSubjects({ activeOnly: true }),
      csrfToken: ctx.csrfToken,
      values,
      errors,
    }),
  });
}

export function registerProfileRoutes(router) {
  /* ---------------------------------------------------------- settings -- */
  router.get('/profile', requireAuth, (ctx) => {
    if (ctx.user.role === 'admin') {
      ctx.redirect('/admin', { type: 'info', message: 'Administrator accounts have no public profile.' });
      return;
    }
    renderProfile(ctx);
  });

  router.post('/profile/account', requireAuth, (ctx) => {
    const v = new Validator(ctx.body);
    const fullName = v.string('fullName', { required: true, label: 'Full name', min: 2, max: 80 });
    if (!v.ok) {
      renderProfile(ctx, { values: { fullName: ctx.body.fullName }, errors: v.errors, status: 422 });
      return;
    }
    updateAccount(ctx.user.id, { fullName });
    ctx.redirect('/profile', { type: 'success', message: 'Account details saved.' });
  });

  router.post('/profile/password', requireAuth, async (ctx) => {
    enforce(limiters.passwordChange, `${ctx.user.id}`, 'Too many attempts. Try again shortly.');

    const v = new Validator(ctx.body);
    const currentPassword = v.password('currentPassword', { label: 'Current password' });
    const newPassword = v.password('newPassword', { label: 'New password' });
    const confirmPassword = v.password('confirmPassword', { label: 'Confirmation' });
    if (v.ok && newPassword !== confirmPassword) {
      v.fail('confirmPassword', 'The two passwords do not match.');
    }
    if (!v.ok) {
      renderProfile(ctx, { passwordErrors: v.errors, status: 422 });
      return;
    }

    try {
      changePassword(ctx.user.id, currentPassword, newPassword, { keepToken: ctx.sessionToken });
    } catch (error) {
      if (error instanceof DomainError) {
        const field = error.code === 'bad_current_password' ? 'currentPassword' : 'newPassword';
        renderProfile(ctx, { passwordErrors: { [field]: error.message }, status: 422 });
        return;
      }
      throw error;
    }

    ctx.redirect('/profile', {
      type: 'success',
      message: 'Password changed. Any other devices have been signed out.',
    });
  });

  router.post('/profile/student', requireStudent, (ctx) => {
    const v = new Validator(ctx.body);
    const programme = v.string('programme', { max: 120, label: 'Programme' });
    const yearOfStudy = v.int('yearOfStudy', { min: 1, max: 10, label: 'Year of study' });
    const goals = v.text('goals', { max: 500, label: 'Goals' });
    const bio = v.text('bio', { max: config.limits.bioLength, label: 'About you' });

    if (!v.ok) {
      renderProfile(ctx, {
        values: {
          programme: ctx.body.programme,
          yearOfStudy: ctx.body.yearOfStudy,
          goals: ctx.body.goals,
          bio: ctx.body.bio,
        },
        errors: v.errors,
        status: 422,
      });
      return;
    }

    saveStudentProfile(ctx.user.id, { programme, yearOfStudy, bio, goals });
    ctx.redirect('/profile', { type: 'success', message: 'Profile saved.' });
  });

  router.post('/profile/tutor', requireTutor, (ctx) => {
    const v = new Validator(ctx.body);
    const headline = v.string('headline', { required: true, min: 10, max: 120, label: 'Headline' });
    const bio = v.text('bio', { max: config.limits.bioLength, label: 'About your tutoring' });
    const mode = v.enum('mode', TUTOR_MODES, { required: true, label: 'Session mode' });
    const campus = v.string('campus', { max: 120, label: 'Campus meeting spot' });
    const meetingLink = v.url('meetingLink', { max: 500, label: 'Online meeting link' });
    const hourlyRateCents = v.money('hourlyRate', { max: 5000, label: 'Indicative rate' });
    const yearsExperience = v.int('yearsExperience', { min: 0, max: 30, label: 'Years tutoring' });

    const values = {
      headline: ctx.body.headline,
      bio: ctx.body.bio,
      mode: ctx.body.mode,
      campus: ctx.body.campus,
      meetingLink: ctx.body.meetingLink,
      hourlyRate: ctx.body.hourlyRate,
      yearsExperience: ctx.body.yearsExperience,
    };

    if (!v.ok) {
      renderProfile(ctx, { values, errors: v.errors, status: 422 });
      return;
    }

    try {
      saveTutorProfile(ctx.user.id, {
        headline,
        bio,
        mode,
        campus,
        meetingLink,
        hourlyRateCents: hourlyRateCents ?? 0,
        yearsExperience: yearsExperience ?? 0,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        const field = /campus/i.test(error.message)
          ? 'campus'
          : /meeting link/i.test(error.message)
            ? 'meetingLink'
            : 'mode';
        renderProfile(ctx, { values, errors: { [field]: error.message }, status: 422 });
        return;
      }
      throw error;
    }

    ctx.redirect('/profile', { type: 'success', message: 'Tutor profile saved.' });
  });

  router.post('/profile/publish', requireTutor, async (ctx) => {
    const profile = await attempt(ctx, '/profile', () => setPublished(ctx.user.id, true));
    if (!profile) return;
    ctx.redirect('/profile', {
      type: 'success',
      message: 'Your profile is published and now appears in tutor search.',
    });
  });

  router.post('/profile/unpublish', requireTutor, async (ctx) => {
    const profile = await attempt(ctx, '/profile', () => setPublished(ctx.user.id, false));
    if (!profile) return;
    ctx.redirect('/profile', {
      type: 'success',
      message: 'Your profile is hidden. Existing sessions are unaffected.',
    });
  });

  /* ---------------------------------------------------------- subjects -- */
  router.get('/profile/subjects', requireTutor, (ctx) => renderSubjects(ctx));

  router.post('/profile/subjects', requireTutor, async (ctx) => {
    const v = new Validator(ctx.body);
    const subjectId = v.int('subjectId', { required: true, min: 1, label: 'Subject' });
    const level = v.enum('level', SUBJECT_LEVELS, { required: true, label: 'Level' });
    if (!v.ok) {
      renderSubjects(ctx, {
        values: { subjectId: ctx.body.subjectId, level: ctx.body.level },
        errors: v.errors,
        status: 422,
      });
      return;
    }

    const subject = await attempt(ctx, '/profile/subjects', () =>
      addTutorSubject(ctx.user.id, subjectId, level)
    );
    if (!subject) return;
    ctx.redirect('/profile/subjects', {
      type: 'success',
      message: `${subject.name} added to your subjects.`,
    });
  });

  router.post('/profile/subjects/remove', requireTutor, async (ctx) => {
    const removed = await attempt(ctx, '/profile/subjects', () =>
      removeTutorSubject(ctx.user.id, ctx.body.subjectId)
    );
    if (!removed) return;
    ctx.redirect('/profile/subjects', { type: 'success', message: 'Subject removed.' });
  });

  /* ------------------------------------------------------ availability -- */
  router.get('/profile/availability', requireTutor, (ctx) => renderAvailability(ctx));

  router.post('/profile/availability', requireTutor, async (ctx) => {
    const v = new Validator(ctx.body);
    const weekday = v.int('weekday', { required: true, min: 0, max: 6, label: 'Day' });
    const start = v.timeMinutes('start', { required: true, label: 'Start time' });
    const end = v.timeMinutes('end', { required: true, label: 'End time' });
    if (v.ok && end <= start) v.fail('end', 'The end time must be after the start time.');

    const values = { weekday: ctx.body.weekday, start: ctx.body.start, end: ctx.body.end };
    if (!v.ok) {
      renderAvailability(ctx, { values, errors: v.errors, status: 422 });
      return;
    }

    const block = await attempt(ctx, '/profile/availability', () =>
      addBlock(ctx.user.id, { weekday, startMinute: start, endMinute: end })
    );
    if (!block) return;

    ctx.redirect('/profile/availability', {
      type: 'success',
      message: `Availability added: ${minutesToTime(start)} - ${minutesToTime(end)}.`,
    });
  });

  router.post('/profile/availability/remove', requireTutor, async (ctx) => {
    const removed = await attempt(ctx, '/profile/availability', () =>
      removeBlock(ctx.user.id, ctx.body.blockId)
    );
    if (!removed) return;
    ctx.redirect('/profile/availability', { type: 'success', message: 'Availability block removed.' });
  });

  router.post('/profile/availability/time-off', requireTutor, async (ctx) => {
    const v = new Validator(ctx.body);
    const date = v.dateKey('date', { required: true, label: 'Date' });
    const note = v.string('note', { max: 120, label: 'Note' });
    if (!v.ok) {
      renderAvailability(ctx, {
        values: { date: ctx.body.date, note: ctx.body.note },
        errors: v.errors,
        status: 422,
      });
      return;
    }

    const entry = await attempt(ctx, '/profile/availability', () =>
      addTimeOff(ctx.user.id, { date, note })
    );
    if (!entry) return;
    ctx.redirect('/profile/availability', {
      type: 'success',
      message: `${date} marked as time off.`,
    });
  });

  router.post('/profile/availability/time-off/remove', requireTutor, async (ctx) => {
    const removed = await attempt(ctx, '/profile/availability', () =>
      removeTimeOff(ctx.user.id, ctx.body.timeOffId)
    );
    if (!removed) return;
    ctx.redirect('/profile/availability', { type: 'success', message: 'Time off removed.' });
  });
}
