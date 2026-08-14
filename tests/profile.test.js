/**
 * Profile rules: student profile persistence, tutor profile validation, subject
 * management and the publication gate (AC-13, AC-14, AC-15, AC-16).
 */
import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import { DomainError } from '../src/lib/errors.js';
import { Validator } from '../src/lib/validate.js';
import { listBlocks, removeBlock } from '../src/services/availability.js';
import {
  addTutorSubject,
  getTutorProfile,
  listTutorSubjects,
  publishRequirements,
  removeTutorSubject,
  saveTutorProfile,
  setPublished,
} from '../src/services/tutors.js';
import {
  getStudentProfile,
  saveStudentProfile,
  studentProfileCompleteness,
  updateAccount,
} from '../src/services/users.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, makeSubjectRecord, makeTutor } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

describe('student profile', () => {
  test('saves and reloads every field', () => {
    const student = makeStudent();
    saveStudentProfile(student.id, {
      programme: 'BSc Computer Science',
      yearOfStudy: 2,
      bio: 'Second year, enjoys algorithms.',
      goals: 'Pass Calculus with a distinction.',
    });

    const reloaded = getStudentProfile(student.id);
    assert.equal(reloaded.programme, 'BSc Computer Science');
    assert.equal(reloaded.year_of_study, 2);
    assert.equal(reloaded.bio, 'Second year, enjoys algorithms.');
    assert.equal(reloaded.goals, 'Pass Calculus with a distinction.');
  });

  test('survives a fresh read through a new connection-level query', () => {
    const student = makeStudent();
    saveStudentProfile(student.id, { programme: 'BA History', yearOfStudy: 1, bio: '', goals: '' });
    const row = ctx.database.get('SELECT programme, year_of_study FROM student_profiles WHERE user_id = ?', [
      student.id,
    ]);
    assert.equal(row.programme, 'BA History');
    assert.equal(row.year_of_study, 1);
  });

  test('an empty save clears fields rather than failing', () => {
    const student = makeStudent();
    saveStudentProfile(student.id, { programme: 'BCom', yearOfStudy: 3, bio: 'x', goals: 'y' });
    saveStudentProfile(student.id, { programme: '', yearOfStudy: null, bio: '', goals: '' });
    const reloaded = getStudentProfile(student.id);
    assert.equal(reloaded.programme, '');
    assert.equal(reloaded.year_of_study, null);
  });

  test('completeness drives the dashboard nudge', () => {
    const student = makeStudent();
    assert.equal(studentProfileCompleteness(student.id).complete, false);
    saveStudentProfile(student.id, {
      programme: 'BSc',
      yearOfStudy: 1,
      bio: '',
      goals: 'Pass the year',
    });
    const after = studentProfileCompleteness(student.id);
    assert.equal(after.complete, true);
    assert.equal(after.done, after.total);
  });

  test('the account name can be changed and is reflected immediately', () => {
    const student = makeStudent({ name: 'Old Name' });
    const updated = updateAccount(student.id, { fullName: 'New Name' });
    assert.equal(updated.full_name, 'New Name');
  });

  test('a database CHECK rejects an out-of-range year even if the service is bypassed', () => {
    const student = makeStudent();
    assert.throws(() =>
      ctx.database.run('UPDATE student_profiles SET year_of_study = 99 WHERE user_id = ?', [student.id])
    );
  });
});

describe('tutor profile validation', () => {
  test('in-person tutors must say where they meet', () => {
    const { user } = makeTutor({ mode: 'online' });
    assert.throws(
      () =>
        saveTutorProfile(user.id, {
          headline: 'Physics tutor with lab experience',
          bio: '',
          mode: 'in_person',
          campus: '',
          meetingLink: '',
          hourlyRateCents: 0,
          yearsExperience: 1,
        }),
      (error) => error instanceof DomainError && /campus/i.test(error.message)
    );
  });

  test('online tutors must supply a meeting link', () => {
    const { user } = makeTutor({ mode: 'in_person' });
    assert.throws(
      () =>
        saveTutorProfile(user.id, {
          headline: 'Chemistry tutor, third year',
          bio: '',
          mode: 'online',
          campus: 'Room 1',
          meetingLink: '',
          hourlyRateCents: 0,
          yearsExperience: 1,
        }),
      (error) => error instanceof DomainError && /meeting link/i.test(error.message)
    );
  });

  test('tutors offering both need a location and a link', () => {
    const { user } = makeTutor({ mode: 'online' });
    assert.throws(
      () =>
        saveTutorProfile(user.id, {
          headline: 'Maths tutor available all week',
          bio: '',
          mode: 'both',
          campus: '',
          meetingLink: 'https://meet.example.edu/x',
          hourlyRateCents: 0,
          yearsExperience: 0,
        }),
      DomainError
    );
  });

  test('an unknown mode is refused', () => {
    const { user } = makeTutor();
    assert.throws(
      () =>
        saveTutorProfile(user.id, {
          headline: 'x'.repeat(20),
          bio: '',
          mode: 'telepathy',
          campus: 'a',
          meetingLink: 'https://x.test/y',
          hourlyRateCents: 0,
          yearsExperience: 0,
        }),
      DomainError
    );
  });

  test('a negative rate is rejected by the database CHECK', () => {
    const { user } = makeTutor();
    assert.throws(() =>
      ctx.database.run('UPDATE tutor_profiles SET hourly_rate_cents = -100 WHERE user_id = ?', [user.id])
    );
  });

  test('the form validator rejects a non-http meeting link and a bad rate', () => {
    const v = new Validator({
      meetingLink: 'javascript:alert(1)',
      hourlyRate: 'free please',
      yearsExperience: '99',
    });
    v.url('meetingLink', { label: 'Online meeting link' });
    v.money('hourlyRate', { label: 'Indicative rate' });
    v.int('yearsExperience', { min: 0, max: 30, label: 'Years tutoring' });

    assert.equal(v.ok, false);
    assert.match(v.errors.meetingLink, /http/);
    assert.match(v.errors.hourlyRate, /amount/);
    assert.match(v.errors.yearsExperience, /30 or less/);
  });

  test('the validator accepts a normal submission and converts money to cents', () => {
    const v = new Validator({
      meetingLink: 'https://meet.example.edu/room',
      hourlyRate: '120.50',
      yearsExperience: '2',
    });
    assert.equal(v.url('meetingLink'), 'https://meet.example.edu/room');
    assert.equal(v.money('hourlyRate'), 12050);
    assert.equal(v.int('yearsExperience'), 2);
    assert.equal(v.ok, true);
  });

  test('saving a profile that no longer qualifies unpublishes it', () => {
    const { user } = makeTutor({ mode: 'online' });
    assert.equal(getTutorProfile(user.id).is_published, 1);
    saveTutorProfile(user.id, {
      headline: '',
      bio: '',
      mode: 'online',
      campus: '',
      meetingLink: 'https://meet.example.edu/x',
      hourlyRateCents: 0,
      yearsExperience: 0,
    });
    assert.equal(getTutorProfile(user.id).is_published, 0, 'a headline-less profile cannot stay live');
  });
});

describe('tutor subjects and the publication gate', () => {
  test('subjects can be added and removed, and duplicates are refused', () => {
    const { user, subject } = makeTutor();
    const extra = makeSubjectRecord({ code: 'ADD1', name: 'Added Subject' });

    addTutorSubject(user.id, extra.id, 'intermediate');
    assert.equal(listTutorSubjects(user.id).length, 2);

    assert.throws(() => addTutorSubject(user.id, extra.id, 'advanced'), DomainError);
    assert.throws(() => addTutorSubject(user.id, extra.id, 'wizard'), DomainError);
    assert.throws(() => addTutorSubject(user.id, 999999, 'intro'), DomainError);

    removeTutorSubject(user.id, extra.id);
    assert.equal(listTutorSubjects(user.id).length, 1);
    assert.throws(() => removeTutorSubject(user.id, extra.id), DomainError);
    assert.equal(listTutorSubjects(user.id)[0].subject_id, subject.id);
  });

  test('one tutor cannot remove another tutor’s subject', () => {
    const first = makeTutor();
    const second = makeTutor();
    assert.throws(() => removeTutorSubject(second.user.id, first.subject.id), DomainError);
    assert.equal(listTutorSubjects(first.user.id).length, 1);
  });

  test('removing the last subject unpublishes the profile', () => {
    const { user, subject } = makeTutor();
    removeTutorSubject(user.id, subject.id);
    assert.equal(getTutorProfile(user.id).is_published, 0);
    assert.equal(publishRequirements(user.id).ok, false);
  });

  test('the gate names exactly what is missing, and publishing is refused until fixed', () => {
    const { user, subject } = makeTutor({ publish: false, blocks: [] });
    removeTutorSubject(user.id, subject.id);

    const requirements = publishRequirements(user.id);
    assert.equal(requirements.ok, false);
    assert.equal(requirements.missing.length, 2, 'subject and availability are both missing');
    assert.match(requirements.missing.join(' | '), /subject/i);
    assert.match(requirements.missing.join(' | '), /availability/i);

    assert.throws(() => setPublished(user.id, true), DomainError);
  });

  test('a complete profile publishes and can be unpublished again', () => {
    const { user } = makeTutor({ publish: false });
    assert.equal(publishRequirements(user.id).ok, true);
    assert.equal(setPublished(user.id, true).is_published, 1);
    assert.equal(setPublished(user.id, false).is_published, 0);
  });

  test('a retired subject stays on the tutor’s list but is flagged inactive', () => {
    const { user, subject } = makeTutor();
    ctx.database.run('UPDATE subjects SET is_active = 0 WHERE id = ?', [subject.id]);
    const mine = listTutorSubjects(user.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].is_active, 0);
  });

  test('availability blocks belong to their owner', () => {
    const { user } = makeTutor();
    const blocks = listBlocks(user.id);
    assert.ok(blocks.length > 0);
    assert.ok(blocks.every((block) => block.tutor_id === user.id));
    removeBlock(user.id, blocks[0].id);
    assert.equal(listBlocks(user.id).length, blocks.length - 1);
  });
});
