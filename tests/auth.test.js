import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import { DomainError } from '../src/lib/errors.js';
import {
  changePassword,
  countSessionsForUser,
  createSession,
  destroySession,
  login,
  purgeExpiredSessions,
  register,
  resolveSession,
} from '../src/services/auth.js';
import { findUserByEmail, setUserStatus } from '../src/services/users.js';
import { revokeSessionsOnSuspension } from '../src/services/auth.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, PASSWORD } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

describe('registration', () => {
  test('creates an account, its role profile and a session', () => {
    const result = register({
      email: 'Newcomer@Test.local',
      password: PASSWORD,
      fullName: 'New Comer',
      role: 'student',
    });

    assert.equal(result.user.email, 'newcomer@test.local', 'email is normalised to lower case');
    assert.equal(result.user.role, 'student');
    assert.ok(result.token);
    assert.ok(result.csrfToken);
    assert.equal(result.user.password_hash, undefined, 'the hash never leaves the service layer');

    const profile = ctx.database.get('SELECT * FROM student_profiles WHERE user_id = ?', [
      result.user.id,
    ]);
    assert.ok(profile, 'a student profile row is created up front');
  });

  test('rejects a duplicate email regardless of case', () => {
    assert.throws(
      () =>
        register({
          email: 'NEWCOMER@test.local',
          password: PASSWORD,
          fullName: 'Impostor',
          role: 'student',
        }),
      (error) => error instanceof DomainError && /already exists/i.test(error.message)
    );
  });

  test('rejects a weak password', () => {
    assert.throws(
      () => register({ email: 'weak@test.local', password: 'short', fullName: 'Weak', role: 'student' }),
      (error) => error instanceof DomainError && /at least 10/.test(error.message)
    );
    assert.equal(findUserByEmail('weak@test.local'), null, 'no partial account is left behind');
  });

  test('rejects an unknown role', () => {
    assert.throws(
      () =>
        register({ email: 'root@test.local', password: PASSWORD, fullName: 'Root', role: 'admin_x' }),
      DomainError
    );
  });
});

describe('login', () => {
  test('accepts correct credentials and records the login', () => {
    const user = makeStudent({ email: 'login1@test.local' });
    const result = login({ email: 'login1@test.local', password: PASSWORD });
    assert.equal(result.user.id, user.id);
    assert.ok(result.user.last_login_at, 'last_login_at is set');
  });

  test('email is not case sensitive', () => {
    makeStudent({ email: 'MixedCase@test.local' });
    const result = login({ email: 'mixedcase@TEST.local', password: PASSWORD });
    assert.ok(result.token);
  });

  test('unknown email and wrong password give the same message', () => {
    makeStudent({ email: 'login2@test.local' });
    let unknownMessage;
    let wrongMessage;
    try {
      login({ email: 'nobody@test.local', password: PASSWORD });
    } catch (error) {
      unknownMessage = error.message;
    }
    try {
      login({ email: 'login2@test.local', password: 'not-the-password' });
    } catch (error) {
      wrongMessage = error.message;
    }
    assert.equal(unknownMessage, wrongMessage);
    assert.match(unknownMessage, /Email or password is incorrect/);
  });

  test('a suspended account cannot sign in', () => {
    const user = makeStudent({ email: 'suspended@test.local' });
    setUserStatus(user.id, 'suspended');
    assert.throws(
      () => login({ email: 'suspended@test.local', password: PASSWORD }),
      (error) => error instanceof DomainError && /suspended/i.test(error.message)
    );
  });
});

describe('sessions', () => {
  test('resolves a valid token to its user', () => {
    const user = makeStudent({ email: 'session1@test.local' });
    const { token } = createSession(user.id, { ip: '127.0.0.1', userAgent: 'test' });
    const resolved = resolveSession(token);
    assert.equal(resolved.user.id, user.id);
  });

  test('stores only the token digest, never the token', () => {
    const user = makeStudent({ email: 'session2@test.local' });
    const { token } = createSession(user.id);
    const rows = ctx.database.all('SELECT token_hash FROM sessions WHERE user_id = ?', [user.id]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].token_hash.length, 64);
  });

  test('rejects unknown, empty and malformed tokens', () => {
    assert.equal(resolveSession('nope'), null);
    assert.equal(resolveSession(''), null);
    assert.equal(resolveSession(undefined), null);
    assert.equal(resolveSession('a'.repeat(64)), null);
  });

  test('an expired session is rejected and cleaned up', () => {
    const user = makeStudent({ email: 'session3@test.local' });
    const { token } = createSession(user.id);
    ctx.database.run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [
      '2000-01-01T00:00:00.000Z',
      user.id,
    ]);
    assert.equal(resolveSession(token), null);
    assert.equal(countSessionsForUser(user.id), 0);
  });

  test('purging removes only expired rows', () => {
    const user = makeStudent({ email: 'session4@test.local' });
    const live = createSession(user.id);
    const stale = createSession(user.id);
    ctx.database.run('UPDATE sessions SET expires_at = ? WHERE token_hash = (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY rowid DESC LIMIT 1)', [
      '2000-01-01T00:00:00.000Z',
      user.id,
    ]);
    purgeExpiredSessions();
    assert.ok(resolveSession(live.token), 'the live session survives');
    assert.equal(resolveSession(stale.token), null);
  });

  test('logout destroys only that session', () => {
    const user = makeStudent({ email: 'session5@test.local' });
    const first = createSession(user.id);
    const second = createSession(user.id);
    destroySession(first.token);
    assert.equal(resolveSession(first.token), null);
    assert.ok(resolveSession(second.token));
  });

  test('suspension revokes live sessions', () => {
    const user = makeStudent({ email: 'session6@test.local' });
    const { token } = createSession(user.id);
    setUserStatus(user.id, 'suspended');
    revokeSessionsOnSuspension(user.id);
    assert.equal(resolveSession(token), null);
  });
});

describe('password change', () => {
  test('requires the current password and revokes other sessions', () => {
    const user = makeStudent({ email: 'pw1@test.local' });
    const current = createSession(user.id);
    const other = createSession(user.id);

    assert.throws(
      () => changePassword(user.id, 'wrong-current', 'a-brand-new-password'),
      (error) => error instanceof DomainError && /current password is incorrect/i.test(error.message)
    );

    changePassword(user.id, PASSWORD, 'a-brand-new-password', { keepToken: current.token });

    assert.ok(resolveSession(current.token), 'the device that changed the password stays signed in');
    assert.equal(resolveSession(other.token), null, 'other sessions are revoked');
    assert.ok(login({ email: 'pw1@test.local', password: 'a-brand-new-password' }).token);
  });

  test('rejects a weak or unchanged new password', () => {
    const user = makeStudent({ email: 'pw2@test.local' });
    assert.throws(() => changePassword(user.id, PASSWORD, 'short'), DomainError);
    assert.throws(() => changePassword(user.id, PASSWORD, PASSWORD), DomainError);
  });
});
