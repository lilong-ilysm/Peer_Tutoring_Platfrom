import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import config from '../src/config.js';
import { DomainError } from '../src/lib/errors.js';
import { dateKeyOf, nowIso } from '../src/lib/time.js';
import {
  addBlock,
  addTimeOff,
  findSlot,
  generateSlots,
  groupSlotsByDay,
  hasAvailability,
  listBlocks,
  removeBlock,
  removeTimeOff,
} from '../src/services/availability.js';
import { publishRequirements } from '../src/services/tutors.js';
import { useTempDatabase } from './helpers/database.js';
import { makeStudent, makeTutor } from './helpers/factory.js';

const ctx = useTempDatabase();
after(() => ctx.cleanup());

describe('weekly blocks', () => {
  test('rejects an end time at or before the start', () => {
    const { user } = makeTutor({ blocks: [] });
    assert.throws(
      () => addBlock(user.id, { weekday: 1, startMinute: 600, endMinute: 600 }),
      (error) => error instanceof DomainError && /after the start/.test(error.message)
    );
    assert.throws(
      () => addBlock(user.id, { weekday: 1, startMinute: 600, endMinute: 300 }),
      DomainError
    );
  });

  test('rejects a block shorter than one slot', () => {
    const { user } = makeTutor({ blocks: [] });
    assert.throws(
      () => addBlock(user.id, { weekday: 1, startMinute: 600, endMinute: 600 + config.slotMinutes - 1 }),
      (error) => error instanceof DomainError && /at least/.test(error.message)
    );
  });

  test('rejects an out-of-range weekday', () => {
    const { user } = makeTutor({ blocks: [] });
    assert.throws(() => addBlock(user.id, { weekday: 9, startMinute: 60, endMinute: 300 }), DomainError);
    assert.throws(() => addBlock(user.id, { weekday: -1, startMinute: 60, endMinute: 300 }), DomainError);
  });

  test('rejects overlapping blocks on the same weekday', () => {
    const { user } = makeTutor({ blocks: [] });
    addBlock(user.id, { weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 });
    assert.throws(
      () => addBlock(user.id, { weekday: 2, startMinute: 11 * 60, endMinute: 13 * 60 }),
      (error) => error instanceof DomainError && /overlaps/.test(error.message)
    );
    // The same clock time on another weekday is fine.
    assert.ok(addBlock(user.id, { weekday: 3, startMinute: 11 * 60, endMinute: 13 * 60 }));
  });

  test('a tutor cannot remove another tutor’s block', () => {
    const first = makeTutor({ blocks: [[1, 9 * 60, 12 * 60]] });
    const second = makeTutor({ blocks: [[1, 9 * 60, 12 * 60]] });
    const target = listBlocks(first.user.id)[0];
    assert.throws(() => removeBlock(second.user.id, target.id), DomainError);
    assert.equal(listBlocks(first.user.id).length, 1, 'the block is untouched');
  });

  test('removing the last block un-publishes the profile', () => {
    const { user } = makeTutor({ blocks: [[1, 9 * 60, 12 * 60]] });
    assert.equal(publishRequirements(user.id).ok, true);
    removeBlock(user.id, listBlocks(user.id)[0].id);
    assert.equal(hasAvailability(user.id), false);
    assert.equal(publishRequirements(user.id).ok, false);
  });
});

describe('slot generation', () => {
  test('produces slots aligned to the block start and slot length', () => {
    const { user } = makeTutor({ blocks: [[0, 8 * 60, 11 * 60], [1, 8 * 60, 11 * 60], [2, 8 * 60, 11 * 60], [3, 8 * 60, 11 * 60], [4, 8 * 60, 11 * 60], [5, 8 * 60, 11 * 60], [6, 8 * 60, 11 * 60]] });
    const slots = generateSlots(user.id);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      const start = new Date(slot.startsAt);
      const end = new Date(slot.endsAt);
      assert.equal((end - start) / 60000, config.slotMinutes);
      assert.equal(start.getUTCMinutes(), 0);
      assert.ok(start.getUTCHours() >= 8 && start.getUTCHours() < 11);
    }
  });

  test('never offers a slot inside the booking lead time', () => {
    const { user } = makeTutor();
    const cutoff = Date.now() + config.bookingLeadHours * 3600 * 1000;
    for (const slot of generateSlots(user.id)) {
      assert.ok(new Date(slot.startsAt).getTime() >= cutoff, `${slot.startsAt} is inside the lead time`);
    }
  });

  test('never offers a slot beyond the booking window', () => {
    const { user } = makeTutor();
    const horizon = Date.now() + (config.bookingWindowDays + 1) * 24 * 3600 * 1000;
    for (const slot of generateSlots(user.id)) {
      assert.ok(new Date(slot.startsAt).getTime() <= horizon);
    }
  });

  test('excludes a date marked as time off', () => {
    const { user } = makeTutor();
    const slots = generateSlots(user.id);
    const targetDate = slots[slots.length - 1].dateKey;
    addTimeOff(user.id, { date: targetDate, note: 'Exam' });

    const after = generateSlots(user.id);
    assert.equal(after.some((slot) => slot.dateKey === targetDate), false);

    const entry = ctx.database.get('SELECT id FROM tutor_time_off WHERE tutor_id = ?', [user.id]);
    removeTimeOff(user.id, entry.id);
    assert.ok(generateSlots(user.id).some((slot) => slot.dateKey === targetDate));
  });

  test('rejects time off in the past and duplicate dates', () => {
    const { user } = makeTutor();
    assert.throws(() => addTimeOff(user.id, { date: '2000-01-01' }), DomainError);
    const today = dateKeyOf(new Date());
    addTimeOff(user.id, { date: today });
    assert.throws(() => addTimeOff(user.id, { date: today }), DomainError);
    assert.throws(() => addTimeOff(user.id, { date: 'not-a-date' }), DomainError);
  });

  test('excludes slots already held by an active booking', () => {
    const { user, subject } = makeTutor();
    const student = makeStudent();
    const slot = generateSlots(user.id)[0];

    ctx.database.run(
      `INSERT INTO bookings (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode,
                             location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 'online', '', ?, ?)`,
      [student.id, user.id, subject.id, slot.startsAt, slot.endsAt, nowIso(), nowIso()]
    );

    const after = generateSlots(user.id);
    assert.equal(after.some((candidate) => candidate.startsAt === slot.startsAt), false);
    assert.equal(findSlot(user.id, slot.startsAt), null);
  });

  test('a cancelled booking releases its slot again', () => {
    const { user, subject } = makeTutor();
    const student = makeStudent();
    const slot = generateSlots(user.id)[0];
    ctx.database.run(
      `INSERT INTO bookings (student_id, tutor_id, subject_id, starts_at, ends_at, status, mode,
                             location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'cancelled', 'online', '', ?, ?)`,
      [student.id, user.id, subject.id, slot.startsAt, slot.endsAt, nowIso(), nowIso()]
    );
    assert.ok(generateSlots(user.id).some((candidate) => candidate.startsAt === slot.startsAt));
  });

  test('a tutor with no availability has no slots', () => {
    const { user } = makeTutor({ blocks: [], publish: false });
    assert.deepEqual(generateSlots(user.id), []);
  });

  test('findSlot matches an exact instant only', () => {
    const { user } = makeTutor();
    const slot = generateSlots(user.id)[0];
    assert.ok(findSlot(user.id, slot.startsAt));
    assert.equal(findSlot(user.id, 'not-a-date'), null);
    assert.equal(findSlot(user.id, '1999-01-01T09:00:00.000Z'), null);
    const offBy1Minute = new Date(new Date(slot.startsAt).getTime() + 60000).toISOString();
    assert.equal(findSlot(user.id, offBy1Minute), null);
  });

  test('grouping preserves order and day boundaries', () => {
    const { user } = makeTutor();
    const days = groupSlotsByDay(generateSlots(user.id));
    assert.ok(days.length > 1);
    const keys = days.map((day) => day.dateKey);
    assert.deepEqual([...keys].sort(), keys, 'days come back in chronological order');
    for (const day of days) {
      assert.ok(day.slots.every((slot) => slot.dateKey === day.dateKey));
    }
  });
});
