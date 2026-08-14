import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  avatarBucket,
  checkPasswordStrength,
  hashPassword,
  randomToken,
  sha256,
  sign,
  timingSafeEqualStrings,
  unsign,
  verifyPassword,
} from '../src/lib/security.js';
import { escapeHtml, html, raw, safeUrl } from '../src/web/views/html.js';
import { safeNextPath } from '../src/lib/http.js';

describe('password hashing', () => {
  test('a password verifies against its own hash', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.ok(stored.startsWith('scrypt$'));
    assert.equal(verifyPassword('correct horse battery staple', stored), true);
  });

  test('the plaintext never appears in the stored value', () => {
    const stored = hashPassword('Sup3rSecret-Password');
    assert.ok(!stored.includes('Sup3rSecret-Password'));
  });

  test('a wrong password fails', () => {
    const stored = hashPassword('Password123!');
    assert.equal(verifyPassword('password123!', stored), false);
    assert.equal(verifyPassword('', stored), false);
  });

  test('two hashes of the same password differ (unique salt)', () => {
    assert.notEqual(hashPassword('Password123!'), hashPassword('Password123!'));
  });

  test('malformed stored hashes fail instead of throwing', () => {
    assert.equal(verifyPassword('x', 'not-a-hash'), false);
    assert.equal(verifyPassword('x', 'scrypt$a$b$c$d$e'), false);
    assert.equal(verifyPassword('x', ''), false);
    assert.equal(verifyPassword('x', null), false);
  });
});

describe('password policy', () => {
  test('rejects short passwords', () => {
    assert.match(checkPasswordStrength('short'), /at least 10/);
  });

  test('rejects a single repeated character', () => {
    assert.match(checkPasswordStrength('aaaaaaaaaaaa'), /repeated/);
  });

  test('accepts a reasonable passphrase', () => {
    assert.equal(checkPasswordStrength('quiet library mornings'), null);
  });
});

describe('tokens and signing', () => {
  test('tokens are unique and url safe', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });

  test('signed values round-trip and reject tampering', () => {
    const signed = sign('conversation-42');
    assert.equal(unsign(signed), 'conversation-42');
    assert.equal(unsign(`${signed}x`), null);
    assert.equal(unsign('conversation-42.bogus'), null);
    assert.equal(unsign('no-dot'), null);
  });

  test('sha256 is stable and hex encoded', () => {
    assert.equal(sha256('abc').length, 64);
    assert.equal(sha256('abc'), sha256('abc'));
  });

  test('constant-time comparison handles length mismatch', () => {
    assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
    assert.equal(timingSafeEqualStrings('abc', 'abcd'), false);
    assert.equal(timingSafeEqualStrings('abc', undefined), false);
  });

  test('avatar bucket is deterministic and in range', () => {
    const bucket = avatarBucket('Maya Reddy');
    assert.equal(bucket, avatarBucket('Maya Reddy'));
    assert.ok(bucket >= 0 && bucket <= 7);
  });
});

describe('output escaping', () => {
  test('escapes the dangerous characters', () => {
    assert.equal(escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });

  test('interpolated values in the html tag are escaped', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const out = html`<p>${evil}</p>`.value;
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('&lt;img'));
  });

  test('raw() opts out explicitly', () => {
    assert.equal(html`<p>${raw('<b>ok</b>')}</p>`.value, '<p><b>ok</b></p>');
  });

  test('arrays and nullish values render predictably', () => {
    assert.equal(html`${[1, 2, 3]}`.value, '123');
    assert.equal(html`${null}${undefined}${false}`.value, '');
  });

  test('safeUrl only allows http(s) and site-relative links', () => {
    assert.equal(safeUrl('https://example.edu/x'), 'https://example.edu/x');
    assert.equal(safeUrl('/tutors/1'), '/tutors/1');
    assert.equal(safeUrl('javascript:alert(1)'), '');
    assert.equal(safeUrl('//evil.example'), '');
    assert.equal(safeUrl('data:text/html,<script>'), '');
  });
});

describe('redirect safety', () => {
  test('only internal paths survive', () => {
    assert.equal(safeNextPath('/bookings'), '/bookings');
    assert.equal(safeNextPath('https://evil.example'), '/dashboard');
    assert.equal(safeNextPath('//evil.example'), '/dashboard');
    assert.equal(safeNextPath('/x\\y'), '/dashboard');
    assert.equal(safeNextPath('/a\nb'), '/dashboard');
    assert.equal(safeNextPath(undefined), '/dashboard');
  });
});
