import { describe, expect, test } from 'bun:test';

import {
  dayBoundsUtc,
  isValidDate,
  isValidTimeZone,
  zonedDayEnd,
  zonedDayStart,
} from '../src/timezone';

test('zonedDayStart and zonedDayEnd', () => {
  // Given: calendar days in several zones
  // When/Then
  expect(zonedDayStart('2026-09-10', 'UTC').toISOString()).toBe('2026-09-10T00:00:00.000Z');
  expect(zonedDayStart('2026-09-10', 'Asia/Saigon').toISOString()).toBe('2026-09-09T17:00:00.000Z');
  expect(zonedDayStart('2026-03-08', 'America/New_York').toISOString()).toBe(
    '2026-03-08T05:00:00.000Z',
  );
  expect(zonedDayStart('2026-11-01', 'America/New_York').toISOString()).toBe(
    '2026-11-01T04:00:00.000Z',
  );
  expect(zonedDayStart('2026-07-01', 'Europe/London').toISOString()).toBe(
    '2026-06-30T23:00:00.000Z',
  );
  expect(zonedDayEnd('2026-09-10', 'Asia/Saigon').toISOString()).toBe('2026-09-10T17:00:00.000Z');
});

test('isValidDate', () => {
  // Given: dates well and badly formed
  // When/Then
  expect(isValidDate('2024-02-29')).toBe(true);
  expect(isValidDate('2026-02-30')).toBe(false);
  expect(isValidDate('2026-1-5')).toBe(false);
  expect(isValidDate('2026-09-10T00:00')).toBe(false);
});

describe('isValidTimeZone', () => {
  test.each(['UTC', 'Asia/Ho_Chi_Minh', 'Europe/Berlin'])('accepts %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });

  test.each(['', 'Mars/Olympus', 'utc '])('rejects %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});

describe('dayBoundsUtc', () => {
  const cases: Array<[string, string, string, string]> = [
    ['2026-09-11', 'UTC', '2026-09-11T00:00:00.000Z', '2026-09-11T23:59:59.999Z'],
    ['2026-09-11', 'Asia/Ho_Chi_Minh', '2026-09-10T17:00:00.000Z', '2026-09-11T16:59:59.999Z'],
    ['2026-03-29', 'Europe/Berlin', '2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z'],
    ['2020-03-08', 'America/Havana', '2020-03-08T05:00:00.000Z', '2020-03-09T03:59:59.999Z'],
  ];

  test.each(cases)('%s in %s', (day, tz, start, end) => {
    const bounds = dayBoundsUtc(day, tz);
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });
});
