import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  addDaysToDateKey,
  dateKeyOf,
  formatRelative,
  intervalsOverlap,
  minutesToTime,
  normaliseDateKey,
  parseTimeToMinutes,
  timezoneOffsetMinutes,
  weekdayOfDateKey,
  zonedParts,
  zonedWallClockToUtc,
} from '../src/lib/time.js';

describe('clock parsing', () => {
  test('parses valid times', () => {
    assert.equal(parseTimeToMinutes('09:30'), 570);
    assert.equal(parseTimeToMinutes('00:00'), 0);
    assert.equal(parseTimeToMinutes('23:59'), 1439);
  });

  test('rejects malformed times', () => {
    for (const value of ['9:5', '24:30', '12:60', 'noon', '', null, '12', '-1:00']) {
      assert.equal(parseTimeToMinutes(value), null, `expected null for ${value}`);
    }
  });

  test('formats minutes back to a clock', () => {
    assert.equal(minutesToTime(570), '09:30');
    assert.equal(minutesToTime(0), '00:00');
    assert.equal(minutesToTime(1439), '23:59');
  });
});

describe('calendar keys', () => {
  test('validates real dates only', () => {
    assert.equal(normaliseDateKey('2026-02-28'), '2026-02-28');
    assert.equal(normaliseDateKey('2026-02-30'), null);
    assert.equal(normaliseDateKey('2026-13-01'), null);
    assert.equal(normaliseDateKey('26-01-01'), null);
  });

  test('adds days across month and year boundaries', () => {
    assert.equal(addDaysToDateKey('2026-01-31', 1), '2026-02-01');
    assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysToDateKey('2026-03-01', -1), '2026-02-28');
  });

  test('weekday index matches the calendar', () => {
    assert.equal(weekdayOfDateKey('2026-08-16'), 0); // Sunday
    assert.equal(weekdayOfDateKey('2026-08-17'), 1); // Monday
  });
});

describe('timezone conversion', () => {
  test('UTC is the identity case', () => {
    const instant = zonedWallClockToUtc('2026-08-17', 9 * 60, 'UTC');
    assert.equal(instant.toISOString(), '2026-08-17T09:00:00.000Z');
  });

  test('handles a zone with and without DST', () => {
    // London: UTC+0 in January, UTC+1 (BST) in July.
    assert.equal(
      zonedWallClockToUtc('2026-01-15', 9 * 60, 'Europe/London').toISOString(),
      '2026-01-15T09:00:00.000Z'
    );
    assert.equal(
      zonedWallClockToUtc('2026-07-15', 9 * 60, 'Europe/London').toISOString(),
      '2026-07-15T08:00:00.000Z'
    );
  });

  test('handles a fixed-offset southern-hemisphere zone', () => {
    assert.equal(
      zonedWallClockToUtc('2026-08-17', 9 * 60, 'Africa/Johannesburg').toISOString(),
      '2026-08-17T07:00:00.000Z'
    );
  });

  test('reports the offset for an instant', () => {
    assert.equal(timezoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/London'), 60);
    assert.equal(timezoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/London'), 0);
    assert.equal(timezoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'UTC'), 0);
  });

  test('zoned parts reflect local wall clock', () => {
    const parts = zonedParts(new Date('2026-07-15T08:00:00Z'), 'Europe/London');
    assert.equal(parts.hour, 9);
    assert.equal(parts.dateKey, '2026-07-15');
    assert.equal(parts.minutes, 9 * 60);
  });

  test('a wall clock time that does not exist still yields a valid instant', () => {
    // 2026-03-29 01:30 does not exist in London (clocks jump 01:00 -> 02:00).
    const instant = zonedWallClockToUtc('2026-03-29', 90, 'Europe/London');
    assert.ok(!Number.isNaN(instant.getTime()));
    assert.equal(instant.toISOString(), '2026-03-29T01:30:00.000Z');
  });

  test('dateKeyOf uses the target zone, not the host zone', () => {
    // 23:30 UTC is already the next day in Johannesburg (+2).
    assert.equal(dateKeyOf('2026-08-17T23:30:00Z', 'Africa/Johannesburg'), '2026-08-18');
    assert.equal(dateKeyOf('2026-08-17T23:30:00Z', 'UTC'), '2026-08-17');
  });
});

describe('intervals and relative time', () => {
  test('overlap detection is half-open', () => {
    assert.equal(
      intervalsOverlap('2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z', '2026-08-17T09:30:00Z', '2026-08-17T10:30:00Z'),
      true
    );
    // Touching at the boundary is not an overlap.
    assert.equal(
      intervalsOverlap('2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z', '2026-08-17T10:00:00Z', '2026-08-17T11:00:00Z'),
      false
    );
  });

  test('relative labels read naturally', () => {
    const base = new Date('2026-08-17T12:00:00Z');
    assert.equal(formatRelative('2026-08-17T11:30:00Z', base), '30 minutes ago');
    assert.equal(formatRelative('2026-08-17T14:00:00Z', base), 'in 2 hours');
    assert.equal(formatRelative('2026-08-16T12:00:00Z', base), '1 day ago');
    assert.equal(formatRelative('2026-08-17T12:00:10Z', base), 'in a moment');
  });
});
