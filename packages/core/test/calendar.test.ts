import { describe, expect, test } from 'bun:test';

import {
  calendarMark,
  calendarQuerySchema,
  isMissed,
  monthGrid,
  monthOf,
  postCalendarTime,
  weekGrid,
  weekOf,
} from '../src/calendar';

const NOW = new Date('2026-09-04T10:00:00Z');

describe('isMissed', () => {
  test('isMissed marks a past draft', () => {
    // Given: now 2026-09-04T10:00:00Z, account connected
    // When
    const missed = isMissed(
      { status: 'draft', scheduled_at: '2026-09-02T09:00:00.000Z' },
      NOW,
      true,
    );
    // Then
    expect(missed).toBe(true);
  });

  test('isMissed marks a past official post only without an account', () => {
    // Given: an official post due in the past
    const post = { status: 'official', scheduled_at: '2026-09-02T09:00:00.000Z' } as const;
    // When / Then
    expect(isMissed(post, NOW, false)).toBe(true);
    expect(isMissed(post, NOW, true)).toBe(false);
  });

  test('isMissed is false for the future, for no time, and for published or failed', () => {
    // Given: now 2026-09-04T10:00:00Z, no account
    // When / Then
    expect(isMissed({ status: 'draft', scheduled_at: '2026-09-06T09:00:00.000Z' }, NOW, false)).toBe(
      false,
    );
    expect(isMissed({ status: 'draft', scheduled_at: null }, NOW, false)).toBe(false);
    expect(
      isMissed({ status: 'published', scheduled_at: '2026-09-02T09:00:00.000Z' }, NOW, false),
    ).toBe(false);
    expect(
      isMissed({ status: 'failed', scheduled_at: '2026-09-02T09:00:00.000Z' }, NOW, false),
    ).toBe(false);
  });
});

test('calendarMark marks missed and failed', () => {
  // Given / When / Then
  expect(calendarMark({ status: 'draft', missed: true })).toBe('MISSED');
  expect(calendarMark({ status: 'failed', missed: false })).toBe('FAILED');
  expect(calendarMark({ status: 'published', missed: false })).toBe('');
});

test('postCalendarTime uses the published time for published posts', () => {
  // Given / When / Then
  expect(
    postCalendarTime({
      status: 'published',
      scheduled_at: '2026-09-20T09:00:00.000Z',
      published_at: '2026-09-11T09:00:00.000Z',
    }),
  ).toBe('2026-09-11T09:00:00.000Z');
  expect(
    postCalendarTime({
      status: 'draft',
      scheduled_at: '2026-09-10T09:00:00.000Z',
      published_at: null,
    }),
  ).toBe('2026-09-10T09:00:00.000Z');
});

test('monthOf and weekOf are calendar aligned, Monday first', () => {
  // Given / When / Then
  expect(monthOf('2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  const week = { from: '2026-09-07', to: '2026-09-13' };
  expect(weekOf('2026-09-10')).toEqual(week);
  expect(weekOf('2026-09-07')).toEqual(week);
  expect(weekOf('2026-09-13')).toEqual(week);
  expect(weekGrid('2026-09-10')).toEqual([
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ]);
});

test('monthGrid drops the sixth row when it is all next month', () => {
  // Given / When
  const sep = monthGrid('2026-09-15');
  const aug = monthGrid('2026-08-01');
  // Then
  expect(sep).toHaveLength(35);
  expect(sep[0]).toBe('2026-08-31');
  expect(sep[sep.length - 1]).toBe('2026-10-04');
  expect(aug).toHaveLength(42);
  expect(aug[0]).toBe('2026-07-27');
  expect(aug[aug.length - 1]).toBe('2026-09-06');
});

test('calendarQuerySchema needs both dates in order', () => {
  // Given / When
  const reversed = calendarQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-09' });
  const missing = calendarQuerySchema.safeParse({ from: '2026-09-10' });
  const tagged = calendarQuerySchema.safeParse({
    from: '2026-09-10',
    to: '2026-09-10',
    tag: 'a',
  });
  // Then
  expect(reversed.success).toBe(false);
  if (reversed.success) throw new Error('unreachable');
  expect(reversed.error.issues[0].path).toEqual(['to']);
  expect(reversed.error.issues[0].message).toBe('to is before from');
  expect(missing.success).toBe(false);
  if (missing.success) throw new Error('unreachable');
  expect(missing.error.issues[0].path).toEqual(['to']);
  expect(tagged.success).toBe(true);
  if (!tagged.success) throw new Error('unreachable');
  expect(tagged.data.tag).toEqual(['a']);
});
