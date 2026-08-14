/**
 * End-to-end HTTP tests against the real request pipeline: guards, CSRF,
 * rendering, authorisation and error handling.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { clearAllLimiters } from '../src/lib/ratelimit.js';
import { generateSlots } from '../src/services/availability.js';
import { createBooking } from '../src/services/bookings.js';
import { getOrCreateConversation, sendMessage } from '../src/services/messages.js';
import { createAgent, startServer } from './helpers/agent.js';
import { useTempDatabase } from './helpers/database.js';
import { makeAdmin, makeStudent, makeTutor, PASSWORD } from './helpers/factory.js';

const ctx = useTempDatabase();

let app;
let tutor;
let subject;
let student;
let otherStudent;
let admin;

before(async () => {
  app = await startServer();
  const created = makeTutor({ name: 'Tara Tutor', email: 'tara@test.local', mode: 'online' });
  tutor = created.user;
  subject = created.subject;
  student = makeStudent({ name: 'Sam Student', email: 'sam@test.local' });
  otherStudent = makeStudent({ name: 'Other Student', email: 'other@test.local' });
  admin = makeAdmin({ name: 'Ada Admin', email: 'ada@test.local' });
});

after(async () => {
  await app.close();
  ctx.cleanup();
});

function agent() {
  return createAgent(app.origin);
}

describe('public pages', () => {
  test('the landing page renders with security headers', async () => {
    const response = await agent().get('/');
    assert.equal(response.status, 200);
    assert.match(response.text, /<h1/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(response.headers.get('content-security-policy')));
  });

  test('search renders published tutors and survives junk filters', async () => {
    const client = agent();
    const listing = await client.get('/tutors');
    assert.equal(listing.status, 200);
    assert.match(listing.text, /Tara Tutor/);

    const junk = await client.get(
      '/tutors?minRating=abc&rating=%3Cscript%3E&page=-42&day=99&maxRate=zzz&sort=drop%20table&subject=abc&q=' +
        encodeURIComponent('<img src=x onerror=alert(1)>')
    );
    assert.equal(junk.status, 200);
    assert.ok(!junk.text.includes('<img src=x'), 'the query echo is escaped');
  });

  test('out-of-range filters are ignored, not clamped into a different filter (QA-01..03)', async () => {
    const client = agent();
    const cards = (text) => (text.match(/class="tutor-card"/g) || []).length;
    const baseline = cards((await client.get('/tutors')).text);
    assert.ok(baseline > 0, 'there is at least one published tutor to count');

    for (const query of ['?subject=0', '?day=99', '?day=-3', '?rating=9', '?maxRate=-5']) {
      const response = await client.get(`/tutors${query}`);
      assert.equal(response.status, 200, `${query} should render`);
      assert.equal(
        cards(response.text),
        baseline,
        `${query} must not silently apply a filter the visitor never asked for`
      );
    }

    // A valid weekday still filters.
    const monday = await client.get('/tutors?day=1');
    assert.equal(monday.status, 200);
  });

  test('unknown pages and unknown tutors return 404', async () => {
    const client = agent();
    assert.equal((await client.get('/nope')).status, 404);
    assert.equal((await client.get('/tutors/424242')).status, 404);
    assert.equal((await client.get('/bookings/424242')).status, 302); // needs auth first
  });

  test('a wrong method on a known path returns 405 with an Allow header', async () => {
    const response = await agent().get('/logout');
    assert.equal(response.status, 405);
    assert.match(response.headers.get('allow'), /POST/);
  });

  test('static assets are served and traversal is refused', async () => {
    const client = agent();
    assert.equal((await client.get('/css/styles.css')).status, 200);
    assert.equal((await client.get('/js/app.js')).status, 200);
    assert.equal((await client.get('/../package.json')).status, 404);
    assert.equal((await client.get('/css/../../../package.json')).status, 404);
  });
});

describe('authentication over HTTP', () => {
  test('protected pages redirect anonymous visitors and remember where they were going', async () => {
    const response = await agent().get('/bookings?scope=past');
    assert.equal(response.status, 302);
    assert.match(response.location, /^\/login\?next=/);
    assert.match(decodeURIComponent(response.location), /\/bookings\?scope=past/);
  });

  test('a state-changing POST without a CSRF token is refused', async () => {
    const response = await agent().post('/login', {
      body: { email: 'sam@test.local', password: PASSWORD },
    });
    assert.equal(response.status, 403);
    assert.match(response.text, /could not be verified/);
  });

  test('a CSRF token from another visitor is refused', async () => {
    const victim = agent();
    const { token } = await victim.csrf('/login');
    const attacker = agent();
    const response = await attacker.post('/login', {
      body: { email: 'sam@test.local', password: PASSWORD, _csrf: token },
    });
    assert.equal(response.status, 403);
  });

  test('registration reports field errors and keeps the input', async () => {
    const client = agent();
    const { token } = await client.csrf('/register');
    const response = await client.post('/register', {
      body: {
        _csrf: token,
        fullName: '',
        email: 'not-an-email',
        password: 'short',
        confirmPassword: 'mismatch',
        role: 'student',
      },
    });
    assert.equal(response.status, 422);
    assert.match(response.text, /Full name is required/);
    assert.match(response.text, /Enter a valid email address/);
    assert.match(response.text, /at least 10 characters/);
    assert.match(response.text, /value="not-an-email"/, 'the typed email is preserved');
    assert.ok(!response.text.includes('short'), 'the rejected password is never echoed');
  });

  test('a duplicate email is reported on the email field', async () => {
    const client = agent();
    const { token } = await client.csrf('/register');
    const response = await client.post('/register', {
      body: {
        _csrf: token,
        fullName: 'Copy Cat',
        email: 'sam@test.local',
        password: 'a-long-enough-password',
        confirmPassword: 'a-long-enough-password',
        role: 'student',
      },
    });
    assert.equal(response.status, 422);
    assert.match(response.text, /already exists/);
  });

  test('registering as a tutor lands on the profile builder', async () => {
    const client = agent();
    const { token } = await client.csrf('/register');
    const response = await client.post('/register', {
      body: {
        _csrf: token,
        fullName: 'Fresh Tutor',
        email: 'fresh-tutor@test.local',
        password: 'a-long-enough-password',
        confirmPassword: 'a-long-enough-password',
        role: 'tutor',
      },
    });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/profile');
    const profile = await client.get('/profile');
    assert.equal(profile.status, 200);
    assert.match(profile.text, /Not visible in search yet/);
  });

  test('bad credentials do not reveal whether the account exists', async () => {
    clearAllLimiters();
    const client = agent();
    const unknown = await client.login('ghost@test.local', PASSWORD);
    const wrong = await client.login('sam@test.local', 'not-the-password');
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.match(unknown.text, /Email or password is incorrect/);
    assert.match(wrong.text, /Email or password is incorrect/);
  });

  test('repeated failures are rate limited', async () => {
    clearAllLimiters();
    const client = agent();
    let sawLimit = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await client.login('sam@test.local', 'wrong-password');
      if (response.status === 429) {
        sawLimit = true;
        break;
      }
    }
    assert.ok(sawLimit, 'expected a 429 after repeated failures');
    clearAllLimiters();
  });

  test('sign in, use the app, then sign out', async () => {
    clearAllLimiters();
    const client = agent();
    const login = await client.login('sam@test.local', PASSWORD);
    assert.equal(login.status, 302);
    assert.equal(login.location, '/dashboard');
    assert.ok(client.jar.has('pl_session'));

    const dashboard = await client.get('/dashboard');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /Hello, Sam/);

    const { token } = await client.csrf('/dashboard');
    const logout = await client.post('/logout', { body: { _csrf: token } });
    assert.equal(logout.status, 302);
    assert.equal(logout.location, '/');
    assert.equal((await client.get('/dashboard')).status, 302);
  });
});

describe('authorisation over HTTP', () => {
  async function signedIn(email) {
    clearAllLimiters();
    const client = agent();
    const response = await client.login(email, PASSWORD);
    assert.equal(response.status, 302, `login for ${email} should succeed`);
    return client;
  }

  test('a student cannot reach tutor-only or admin-only pages', async () => {
    const client = await signedIn('sam@test.local');
    for (const path of ['/profile/availability', '/profile/subjects', '/admin', '/admin/users']) {
      const response = await client.get(path);
      assert.equal(response.status, 403, `${path} should be forbidden for a student`);
    }
  });

  test('a tutor cannot reach the admin console or request a session', async () => {
    const client = await signedIn('tara@test.local');
    assert.equal((await client.get('/admin')).status, 403);
    assert.equal((await client.get('/bookings/new?tutor=1&slot=x')).status, 403);
  });

  test('an admin is redirected from the student dashboard to the console', async () => {
    const client = await signedIn('ada@test.local');
    const response = await client.get('/dashboard');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin');
    for (const path of ['/admin', '/admin/users', '/admin/subjects', '/admin/reviews', '/admin/audit']) {
      assert.equal((await client.get(path)).status, 200, `${path} should render for an admin`);
    }
  });

  test('one student cannot see another student’s booking or conversation', async () => {
    const slot = generateSlots(tutor.id)[0];
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
      note: 'Private note about my marks',
    });
    const conversation = getOrCreateConversation(student.id, tutor.id);
    sendMessage({ conversationId: conversation.id, senderId: student.id, body: 'Private message' });

    const intruder = await signedIn('other@test.local');
    const bookingResponse = await intruder.get(`/bookings/${booking.id}`);
    assert.equal(bookingResponse.status, 404);
    assert.ok(!bookingResponse.text.includes('Private note'));

    const conversationResponse = await intruder.get(`/messages/${conversation.id}`);
    assert.equal(conversationResponse.status, 404);
    assert.ok(!conversationResponse.text.includes('Private message'));

    const apiResponse = await intruder.get(`/api/conversations/${conversation.id}/messages`);
    assert.equal(apiResponse.status, 404);

    // The owner can see both.
    const owner = await signedIn('sam@test.local');
    assert.equal((await owner.get(`/bookings/${booking.id}`)).status, 200);
    assert.equal((await owner.get(`/messages/${conversation.id}`)).status, 200);
  });

  test('a student cannot accept a booking even with a valid CSRF token', async () => {
    const slot = generateSlots(tutor.id)[1];
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
    });
    const client = await signedIn('sam@test.local');
    const { token } = await client.csrf(`/bookings/${booking.id}`);
    const response = await client.post(`/bookings/${booking.id}/accept`, { body: { _csrf: token } });
    assert.equal(response.status, 403);
  });

  test('an admin sees a read-only view of a booking, with no dead controls (PM-1)', async () => {
    const slot = generateSlots(tutor.id)[7];
    const booking = createBooking({
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subject.id,
      startsAt: slot.startsAt,
    });

    const adminClient = await signedIn('ada@test.local');
    const detail = await adminClient.get(`/bookings/${booking.id}`);
    assert.equal(detail.status, 200, 'an admin may inspect a booking');
    assert.match(detail.text, /Read-only/);
    assert.ok(!detail.text.includes('Cancel this session'), 'no cancel control is offered');
    assert.ok(!detail.text.includes('Accept request'), 'no accept control is offered');
    assert.ok(!detail.text.includes('Decline this request'), 'no decline control is offered');
    assert.match(detail.text, /Sam Student/);
    assert.match(detail.text, /Tara Tutor/);

    // And the permission is still enforced if the request is forged by hand.
    const { token } = await adminClient.csrf('/admin');
    const forced = await adminClient.post(`/bookings/${booking.id}/cancel`, {
      body: { _csrf: token, reason: 'Administrator attempting a participant action' },
    });
    assert.equal(forced.status, 403);

    const student2 = await signedIn('sam@test.local');
    const stillActive = await student2.get(`/bookings/${booking.id}`);
    assert.match(stillActive.text, /Pending/);
  });

  test('the notification API only ever counts the caller’s notifications', async () => {
    const tutorClient = await signedIn('tara@test.local');
    const tutorCount = (await tutorClient.get('/api/notifications/unread-count')).json().count;
    assert.ok(tutorCount > 0, 'the tutor has booking notifications');

    const strangerClient = await signedIn('other@test.local');
    const strangerCount = (await strangerClient.get('/api/notifications/unread-count')).json().count;
    assert.equal(strangerCount, 0);
  });
});

describe('booking and messaging flows over HTTP', () => {
  async function signedIn(email) {
    clearAllLimiters();
    const client = agent();
    await client.login(email, PASSWORD);
    return client;
  }

  test('a student books a slot, and the slot is then gone', async () => {
    const client = await signedIn('sam@test.local');
    const slot = generateSlots(tutor.id)[3];
    const path = `/bookings/new?tutor=${tutor.id}&slot=${encodeURIComponent(slot.startsAt)}`;

    const form = await client.get(path);
    assert.equal(form.status, 200);
    const token = /name="_csrf" value="([^"]+)"/.exec(form.text)[1];

    const created = await client.post('/bookings', {
      body: {
        _csrf: token,
        tutorId: String(tutor.id),
        startsAt: slot.startsAt,
        subjectId: String(subject.id),
        note: 'Bringing <b>my</b> notes',
      },
    });
    assert.equal(created.status, 302);
    assert.match(created.location, /^\/bookings\/\d+$/);

    const detail = await client.get(created.location);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Pending/);
    assert.match(detail.text, /&lt;b&gt;my&lt;\/b&gt;/, 'the note is escaped, not rendered as markup');
    assert.ok(!detail.text.includes('Bringing <b>my</b>'));

    // The same slot can no longer be requested.
    const again = await client.get(path);
    assert.equal(again.status, 302, 'the taken slot redirects back to the profile');
  });

  test('an invalid booking submission re-renders the form with the note intact', async () => {
    const client = await signedIn('sam@test.local');
    const slot = generateSlots(tutor.id)[5];
    const form = await client.get(
      `/bookings/new?tutor=${tutor.id}&slot=${encodeURIComponent(slot.startsAt)}`
    );
    const token = /name="_csrf" value="([^"]+)"/.exec(form.text)[1];

    const response = await client.post('/bookings', {
      body: {
        _csrf: token,
        tutorId: String(tutor.id),
        startsAt: slot.startsAt,
        subjectId: '',
        note: 'Keep this text',
      },
    });
    assert.equal(response.status, 422);
    assert.match(response.text, /Subject is required/);
    assert.match(response.text, /Keep this text/);
  });

  test('messages render escaped and empty messages are rejected', async () => {
    const client = await signedIn('sam@test.local');
    const conversation = getOrCreateConversation(student.id, tutor.id);
    const thread = await client.get(`/messages/${conversation.id}`);
    assert.equal(thread.status, 200);
    const token = /name="_csrf" value="([^"]+)"/.exec(thread.text)[1];

    const empty = await client.post(`/messages/${conversation.id}`, {
      body: { _csrf: token, body: '   ' },
    });
    assert.equal(empty.status, 302);

    const posted = await client.post(`/messages/${conversation.id}`, {
      body: { _csrf: token, body: '<script>alert(1)</script>' },
    });
    assert.equal(posted.status, 302);

    const rendered = await client.get(`/messages/${conversation.id}`);
    assert.ok(!rendered.text.includes('<script>alert(1)</script>'));
    assert.match(rendered.text, /&lt;script&gt;/);
  });

  test('an oversized request body is rejected rather than crashing', async () => {
    const client = await signedIn('sam@test.local');
    const conversation = getOrCreateConversation(student.id, tutor.id);
    const { token } = await client.csrf(`/messages/${conversation.id}`);
    const response = await client.post(`/messages/${conversation.id}`, {
      body: `_csrf=${encodeURIComponent(token)}&body=${'x'.repeat(200000)}`,
    });
    assert.ok([413, 400, 302, 500].includes(response.status), `unexpected status ${response.status}`);
    assert.ok(!response.text.includes('at Object.'), 'no stack trace is leaked');
  });

  test('a tutor accepts a request and the student sees it confirmed', async () => {
    const tutorClient = await signedIn('tara@test.local');
    const pending = await tutorClient.get('/bookings?scope=pending');
    assert.equal(pending.status, 200);
    const bookingId = /\/bookings\/(\d+)/.exec(pending.text)[1];

    const detail = await tutorClient.get(`/bookings/${bookingId}`);
    const token = /name="_csrf" value="([^"]+)"/.exec(detail.text)[1];
    const accepted = await tutorClient.post(`/bookings/${bookingId}/accept`, { body: { _csrf: token } });
    assert.equal(accepted.status, 302);

    const studentClient = await signedIn('sam@test.local');
    const confirmed = await studentClient.get(`/bookings/${bookingId}`);
    assert.match(confirmed.text, /Confirmed/);
  });

  test('cancelling without a reason is refused, with a reason it succeeds', async () => {
    const client = await signedIn('sam@test.local');
    const upcoming = await client.get('/bookings?scope=upcoming');
    const bookingId = /\/bookings\/(\d+)/.exec(upcoming.text)[1];
    const detail = await client.get(`/bookings/${bookingId}`);
    const token = /name="_csrf" value="([^"]+)"/.exec(detail.text)[1];

    const noReason = await client.post(`/bookings/${bookingId}/cancel`, { body: { _csrf: token, reason: '' } });
    assert.equal(noReason.status, 302);
    const stillActive = await client.get(`/bookings/${bookingId}`);
    assert.ok(!/Cancelled<\/span>/.test(stillActive.text) || /Reason is required/.test(stillActive.text));

    const cancelled = await client.post(`/bookings/${bookingId}/cancel`, {
      body: { _csrf: token, reason: 'Timetable clash came up.' },
    });
    assert.equal(cancelled.status, 302);
    const after = await client.get(`/bookings/${bookingId}`);
    assert.match(after.text, /Cancelled/);
    assert.match(after.text, /Timetable clash came up/);
  });

  test('a tutor can add availability and the change is reflected immediately', async () => {
    const client = await signedIn('tara@test.local');
    const page = await client.get('/profile/availability');
    assert.equal(page.status, 200);
    const token = /name="_csrf" value="([^"]+)"/.exec(page.text)[1];

    const bad = await client.post('/profile/availability', {
      body: { _csrf: token, weekday: '1', start: '18:00', end: '17:00' },
    });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /end time must be after/i);

    const overlapping = await client.post('/profile/availability', {
      body: { _csrf: token, weekday: '1', start: '09:00', end: '10:00' },
    });
    assert.equal(overlapping.status, 302, 'overlap is reported through a flash redirect');

    const reload = await client.get('/profile/availability');
    assert.match(reload.text, /08:00/);
  });
});
