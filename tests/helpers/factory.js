/**
 * Test data builders. They go through the real services so tests exercise the
 * same rules the application does.
 */
import { addBlock } from '../../src/services/availability.js';
import { createSubject } from '../../src/services/subjects.js';
import {
  addTutorSubject,
  saveTutorProfile,
  setPublished,
} from '../../src/services/tutors.js';
import { createUser } from '../../src/services/users.js';

export const PASSWORD = 'Password123!';

let counter = 0;
function nextEmail(prefix) {
  counter += 1;
  return `${prefix}${counter}@test.local`;
}

export function makeStudent({ name = 'Test Student', email, password = PASSWORD } = {}) {
  return createUser({ email: email || nextEmail('student'), password, fullName: name, role: 'student' });
}

export function makeAdmin({ name = 'Test Admin', email, password = PASSWORD } = {}) {
  return createUser({ email: email || nextEmail('admin'), password, fullName: name, role: 'admin' });
}

export function makeSubjectRecord({ code, name, category = 'Testing' } = {}) {
  counter += 1;
  return createSubject({
    code: code || `TST${counter}`,
    name: name || `Test Subject ${counter}`,
    category,
  });
}

/**
 * A fully bookable tutor: profile, one subject, availability every day, and a
 * published profile.
 */
export function makeTutor({
  name = 'Test Tutor',
  email,
  password = PASSWORD,
  mode = 'online',
  rateCents = 10000,
  subject,
  level = 'advanced',
  publish = true,
  blocks = [0, 1, 2, 3, 4, 5, 6].map((weekday) => [weekday, 8 * 60, 20 * 60]),
} = {}) {
  const user = createUser({
    email: email || nextEmail('tutor'),
    password,
    fullName: name,
    role: 'tutor',
  });

  saveTutorProfile(user.id, {
    headline: `${name} helps with everything`,
    bio: 'Experienced peer tutor for testing purposes.',
    mode,
    campus: mode === 'online' ? '' : 'Library room 1',
    meetingLink: mode === 'in_person' ? '' : 'https://meet.example.edu/test',
    hourlyRateCents: rateCents,
    yearsExperience: 2,
  });

  const chosenSubject = subject || makeSubjectRecord();
  addTutorSubject(user.id, chosenSubject.id, level);

  for (const [weekday, startMinute, endMinute] of blocks) {
    addBlock(user.id, { weekday, startMinute, endMinute });
  }

  // Publishing is gated on a complete profile, so only attempt it when the
  // fixture actually qualifies (a tutor with no availability cannot publish).
  if (publish && blocks.length > 0) setPublished(user.id, true);

  return { user, subject: chosenSubject };
}
