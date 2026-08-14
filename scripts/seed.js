#!/usr/bin/env node
/**
 * Seed the database with a realistic demo dataset.
 *
 * Usage:
 *   npm run seed            # seeds an empty database, refuses to duplicate
 *   npm run seed -- --force # wipes existing data first
 *
 * Passwords are hashed with scrypt like any other account - the plaintext demo
 * password exists only in this script and in the README, and is not a secret.
 */
import config from '../src/config.js';
import { getDb } from '../src/db/index.js';
import { hashPassword } from '../src/lib/security.js';
import { nowIso } from '../src/lib/time.js';
import { generateSlots } from '../src/services/availability.js';
import { notify, NOTIFICATION_TYPES } from '../src/services/notifications.js';
import { recomputeTutorRating } from '../src/services/reviews.js';
import { getOrCreateConversation, sendMessage } from '../src/services/messages.js';

const DEMO_PASSWORD = 'Password123!';
const force = process.argv.includes('--force');
const db = getDb();

const SUBJECTS = [
  ['MAT101', 'Calculus I', 'Mathematics'],
  ['MAT102', 'Linear Algebra', 'Mathematics'],
  ['STA110', 'Introduction to Statistics', 'Mathematics'],
  ['CSC101', 'Introduction to Programming', 'Computer Science'],
  ['CSC211', 'Data Structures', 'Computer Science'],
  ['CSC240', 'Databases', 'Computer Science'],
  ['PHY101', 'Mechanics', 'Physics'],
  ['CHE101', 'General Chemistry', 'Chemistry'],
  ['BIO101', 'Cell Biology', 'Life Sciences'],
  ['ECO101', 'Microeconomics', 'Economics'],
  ['ACC101', 'Financial Accounting', 'Commerce'],
  ['ENG101', 'Academic Writing', 'Humanities'],
  ['PSY101', 'Introduction to Psychology', 'Humanities'],
  ['LAW101', 'Introduction to Law', 'Law'],
];

const TUTORS = [
  {
    name: 'Naledi Mokoena',
    email: 'naledi@peerlearn.test',
    headline: 'Third-year maths student, distinction in Calculus I and Linear Algebra',
    bio: 'I tutor the way I wish I had been taught: work through a real past paper, stop at the exact step that breaks, and fix the idea underneath it. Bring your notes and the questions you got wrong.',
    mode: 'both',
    campus: 'Main library, group study room 2',
    link: 'https://meet.example.edu/naledi',
    rate: 12000,
    years: 2,
    subjects: [['MAT101', 'advanced'], ['MAT102', 'intermediate'], ['STA110', 'intermediate']],
    availability: [[1, 9, 12], [3, 14, 17], [5, 9, 11]],
  },
  {
    name: 'Thabo Nkosi',
    email: 'thabo@peerlearn.test',
    headline: 'CS tutor for first and second year: programming, data structures, SQL',
    bio: 'I do not write your assignment for you, but I will sit with you until you can debug it yourself. Screen share, small steps, lots of print statements. Free because someone did the same for me.',
    mode: 'online',
    campus: '',
    link: 'https://meet.example.edu/thabo',
    rate: 0,
    years: 3,
    subjects: [['CSC101', 'advanced'], ['CSC211', 'advanced'], ['CSC240', 'intermediate']],
    availability: [[2, 17, 20], [4, 17, 20], [6, 10, 13]],
  },
  {
    name: 'Aisha Patel',
    email: 'aisha@peerlearn.test',
    headline: 'Chemistry demonstrator - stoichiometry, equilibria and lab reports',
    bio: 'Second-year chemistry demonstrator. I am strongest on the calculation-heavy parts of first-year chemistry and on writing lab reports that actually score marks.',
    mode: 'in_person',
    campus: 'Science building, room C104',
    link: '',
    rate: 9000,
    years: 1,
    subjects: [['CHE101', 'advanced'], ['BIO101', 'intermediate']],
    availability: [[1, 13, 16], [3, 9, 12]],
  },
  {
    name: "Liam O'Connor",
    email: 'liam@peerlearn.test',
    headline: 'Physics and maths: mechanics problem-solving without the panic',
    bio: 'Most mechanics questions are three or four patterns wearing different clothes. I will show you the patterns and then make you do them until they are boring.',
    mode: 'both',
    campus: 'Engineering foyer, table 5',
    link: 'https://meet.example.edu/liam',
    rate: 15000,
    years: 4,
    subjects: [['PHY101', 'advanced'], ['MAT101', 'intermediate']],
    availability: [[2, 9, 12], [4, 13, 16]],
  },
  {
    name: 'Sipho Dlamini',
    email: 'sipho@peerlearn.test',
    headline: 'Economics and accounting tutor, exam technique focused',
    bio: 'Third-year commerce student. Graphs, marginal thinking and how to answer a long question so the marker can find your marks.',
    mode: 'online',
    campus: '',
    link: 'https://meet.example.edu/sipho',
    rate: 8000,
    years: 2,
    subjects: [['ECO101', 'advanced'], ['ACC101', 'intermediate']],
    availability: [[3, 18, 21], [0, 10, 12]],
  },
  {
    name: 'Emma Weber',
    email: 'emma@peerlearn.test',
    headline: 'Academic writing: structure, argument and referencing',
    bio: 'I help with essay structure and argument, not proofreading. Send me your outline before the session and we will use the time properly.',
    mode: 'both',
    campus: 'Humanities building, writing centre',
    link: 'https://meet.example.edu/emma',
    rate: 0,
    years: 1,
    subjects: [['ENG101', 'advanced'], ['PSY101', 'intermediate']],
    availability: [[1, 16, 18], [4, 9, 11], [6, 14, 16]],
  },
];

const STUDENTS = [
  ['Maya Reddy', 'maya@peerlearn.test', 'BSc Computer Science', 1, 'Calculus test in three weeks and I keep losing marks on limits.'],
  ['Daniel Botha', 'daniel@peerlearn.test', 'BCom Accounting', 2, 'Trying to get from a pass to a solid mark in accounting.'],
  ['Zanele Khumalo', 'zanele@peerlearn.test', 'BSc Chemistry', 1, 'Lab reports take me forever and still lose marks.'],
  ['Ryan Feldman', 'ryan@peerlearn.test', 'BA Psychology', 3, 'Need help structuring my research essay.'],
  ['Chloe Adams', 'chloe@peerlearn.test', 'BEng Mechanical', 2, 'Mechanics problems: I understand the theory but freeze in tests.'],
];

function wipe() {
  const tables = [
    'audit_log',
    'notifications',
    'messages',
    'conversations',
    'reviews',
    'bookings',
    'tutor_time_off',
    'availability_blocks',
    'tutor_subjects',
    'tutor_profiles',
    'student_profiles',
    'sessions',
    'users',
    'subjects',
  ];
  db.transaction(() => {
    for (const table of tables) db.run(`DELETE FROM ${table}`);
  });
}

function createUser({ name, email, role, password }) {
  const timestamp = nowIso();
  const { lastInsertRowid } = db.run(
    `INSERT INTO users (email, password_hash, role, full_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [email.toLowerCase(), hashPassword(password), role, name, timestamp, timestamp]
  );
  return lastInsertRowid;
}

function main() {
  const existing = Number(db.value('SELECT COUNT(*) AS c FROM users') || 0);
  if (existing > 0 && !force) {
    console.log(
      `Database already contains ${existing} users. Re-run with "npm run seed -- --force" to replace the data.`
    );
    return;
  }
  if (existing > 0) wipe();

  /* ------------------------------------------------------------ subjects */
  const subjectIds = new Map();
  for (const [code, name, category] of SUBJECTS) {
    const { lastInsertRowid } = db.run(
      'INSERT INTO subjects (code, name, category, is_active) VALUES (?, ?, ?, 1)',
      [code, name, category]
    );
    subjectIds.set(code, lastInsertRowid);
  }

  /* --------------------------------------------------------------- admin */
  const adminId = createUser({
    name: 'Platform Administrator',
    email: config.seed.adminEmail,
    role: 'admin',
    password: config.seed.adminPassword,
  });

  /* -------------------------------------------------------------- tutors */
  const tutorIds = new Map();
  for (const tutor of TUTORS) {
    const id = createUser({ name: tutor.name, email: tutor.email, role: 'tutor', password: DEMO_PASSWORD });
    tutorIds.set(tutor.email, id);

    db.run(
      `INSERT INTO tutor_profiles
         (user_id, headline, bio, mode, campus, meeting_link, hourly_rate_cents,
          years_experience, is_published, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        tutor.headline,
        tutor.bio,
        tutor.mode,
        tutor.campus,
        tutor.link,
        tutor.rate,
        tutor.years,
        nowIso(),
      ]
    );

    for (const [code, level] of tutor.subjects) {
      db.run(
        'INSERT INTO tutor_subjects (tutor_id, subject_id, level, created_at) VALUES (?, ?, ?, ?)',
        [id, subjectIds.get(code), level, nowIso()]
      );
    }

    for (const [weekday, startHour, endHour] of tutor.availability) {
      db.run(
        `INSERT INTO availability_blocks (tutor_id, weekday, start_minute, end_minute, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, weekday, startHour * 60, endHour * 60, nowIso()]
      );
    }
  }

  // A deliberately incomplete tutor: proves the publication gate is real.
  const unpublishedTutorId = createUser({
    name: 'Kabelo Sithole',
    email: 'kabelo@peerlearn.test',
    role: 'tutor',
    password: DEMO_PASSWORD,
  });
  db.run(
    `INSERT INTO tutor_profiles (user_id, headline, bio, mode, campus, meeting_link, is_published, updated_at)
     VALUES (?, '', '', 'both', '', '', 0, ?)`,
    [unpublishedTutorId, nowIso()]
  );

  /* ------------------------------------------------------------ students */
  const studentIds = new Map();
  for (const [name, email, programme, year, goals] of STUDENTS) {
    const id = createUser({ name, email, role: 'student', password: DEMO_PASSWORD });
    studentIds.set(email, id);
    db.run(
      `INSERT INTO student_profiles (user_id, programme, year_of_study, bio, goals, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`,
      [id, programme, year, goals, nowIso()]
    );
  }

  /* ------------------------------------------------- completed history --- */
  const history = [
    ['maya@peerlearn.test', 'naledi@peerlearn.test', 'MAT101', 12, 5, 'Finally understand limits. She spotted the exact step I kept skipping.'],
    ['maya@peerlearn.test', 'naledi@peerlearn.test', 'MAT101', 5, 5, 'Second session was just as good. Worked through a full past paper.'],
    ['chloe@peerlearn.test', 'liam@peerlearn.test', 'PHY101', 9, 4, 'Good session, very patient. Would have liked a few more practice problems to take away.'],
    ['daniel@peerlearn.test', 'sipho@peerlearn.test', 'ACC101', 7, 5, 'Explained the whole accounting equation in one go. Worth it.'],
    ['zanele@peerlearn.test', 'aisha@peerlearn.test', 'CHE101', 4, 4, 'Lab report structure makes sense now.'],
    ['ryan@peerlearn.test', 'emma@peerlearn.test', 'ENG101', 3, 5, 'My essay finally has an argument instead of a list of facts.'],
    ['maya@peerlearn.test', 'thabo@peerlearn.test', 'CSC101', 6, null, null],
  ];

  for (const [studentEmail, tutorEmail, code, daysAgo, rating, comment] of history) {
    const studentId = studentIds.get(studentEmail);
    const tutorId = tutorIds.get(tutorEmail);
    const start = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    start.setUTCHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + config.slotMinutes * 60000);
    const tutorProfile = db.get('SELECT mode, campus, meeting_link FROM tutor_profiles WHERE user_id = ?', [tutorId]);
    const mode = tutorProfile.mode === 'both' ? 'in_person' : tutorProfile.mode;

    const { lastInsertRowid: bookingId } = db.run(
      `INSERT INTO bookings
         (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode, location,
          student_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
      [
        studentId,
        tutorId,
        subjectIds.get(code),
        start.toISOString(),
        end.toISOString(),
        mode,
        mode === 'online' ? tutorProfile.meeting_link : tutorProfile.campus,
        'Session booked through the demo seed data.',
        new Date(start.getTime() - 3 * 24 * 3600 * 1000).toISOString(),
        end.toISOString(),
      ]
    );

    if (rating) {
      db.run(
        `INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bookingId, studentId, tutorId, rating, comment || '', new Date(end.getTime() + 3600000).toISOString()]
      );
    }
  }

  for (const tutorId of tutorIds.values()) recomputeTutorRating(tutorId);

  /* --------------------------------------------------- upcoming sessions - */
  // Real slots from the live generator, so demo data respects every rule.
  const upcoming = [
    ['maya@peerlearn.test', 'naledi@peerlearn.test', 'MAT101', 'confirmed', 0],
    ['chloe@peerlearn.test', 'liam@peerlearn.test', 'PHY101', 'pending', 0],
    ['daniel@peerlearn.test', 'sipho@peerlearn.test', 'ECO101', 'pending', 1],
    ['zanele@peerlearn.test', 'aisha@peerlearn.test', 'BIO101', 'confirmed', 1],
    ['ryan@peerlearn.test', 'thabo@peerlearn.test', 'CSC101', 'confirmed', 2],
  ];

  for (const [studentEmail, tutorEmail, code, status, slotIndex] of upcoming) {
    const studentId = studentIds.get(studentEmail);
    const tutorId = tutorIds.get(tutorEmail);
    const slots = generateSlots(tutorId);
    const slot = slots[slotIndex];
    if (!slot) continue;

    const tutorProfile = db.get('SELECT mode, campus, meeting_link FROM tutor_profiles WHERE user_id = ?', [tutorId]);
    const mode = tutorProfile.mode === 'both' ? 'online' : tutorProfile.mode;

    const { lastInsertRowid: bookingId } = db.run(
      `INSERT INTO bookings
         (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode, location,
          student_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        tutorId,
        subjectIds.get(code),
        slot.startsAt,
        slot.endsAt,
        status,
        mode,
        mode === 'online' ? tutorProfile.meeting_link : tutorProfile.campus,
        status === 'pending'
          ? 'I am stuck on the tutorial questions from week 4.'
          : 'Bringing my past papers and the notes from last week.',
        nowIso(),
        nowIso(),
      ]
    );

    if (status === 'pending') {
      notify(tutorId, {
        type: NOTIFICATION_TYPES.BOOKING_REQUESTED,
        title: 'New session request',
        body: 'A student requested a session with you.',
        link: `/bookings/${bookingId}`,
      });
    } else {
      notify(studentId, {
        type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
        title: 'Session confirmed',
        body: 'Your tutor accepted the session.',
        link: `/bookings/${bookingId}`,
      });
    }
  }

  /* ----------------------------------------------------------- messages -- */
  const conversation = getOrCreateConversation(
    studentIds.get('maya@peerlearn.test'),
    tutorIds.get('naledi@peerlearn.test')
  );
  sendMessage({
    conversationId: conversation.id,
    senderId: studentIds.get('maya@peerlearn.test'),
    body: 'Hi Naledi - should I bring anything specific for our session?',
  });
  sendMessage({
    conversationId: conversation.id,
    senderId: tutorIds.get('naledi@peerlearn.test'),
    body: 'Hi Maya! Bring last year’s test paper and your lecture notes on limits. We will work through the parts you lost marks on.',
  });

  const conversation2 = getOrCreateConversation(
    studentIds.get('chloe@peerlearn.test'),
    tutorIds.get('liam@peerlearn.test')
  );
  sendMessage({
    conversationId: conversation2.id,
    senderId: studentIds.get('chloe@peerlearn.test'),
    body: 'Hi Liam, I sent a request for Thursday. Is that still open?',
  });

  /* -------------------------------------------------------------- audit -- */
  db.run(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, meta, created_at)
     VALUES (?, 'seed.bootstrap', 'platform', '', ?, ?)`,
    [adminId, JSON.stringify({ subjects: SUBJECTS.length, tutors: TUTORS.length }), nowIso()]
  );

  const counts = {
    users: db.value('SELECT COUNT(*) AS c FROM users'),
    subjects: db.value('SELECT COUNT(*) AS c FROM subjects'),
    bookings: db.value('SELECT COUNT(*) AS c FROM bookings'),
    reviews: db.value('SELECT COUNT(*) AS c FROM reviews'),
    messages: db.value('SELECT COUNT(*) AS c FROM messages'),
  };

  console.log('Seed complete.');
  console.log(`  users: ${counts.users}, subjects: ${counts.subjects}, bookings: ${counts.bookings}, reviews: ${counts.reviews}, messages: ${counts.messages}`);
  console.log('');
  console.log('Demo accounts (all use the same demo password):');
  console.log(`  admin   ${config.seed.adminEmail}  (password from SEED_ADMIN_PASSWORD)`);
  console.log(`  tutor   naledi@peerlearn.test      ${DEMO_PASSWORD}`);
  console.log(`  tutor   thabo@peerlearn.test       ${DEMO_PASSWORD}`);
  console.log(`  student maya@peerlearn.test        ${DEMO_PASSWORD}`);
  console.log(`  student chloe@peerlearn.test       ${DEMO_PASSWORD}`);
  console.log('');
  console.log(`Timezone: ${config.timezone}. Slot length: ${config.slotMinutes} minutes.`);
}

main();
