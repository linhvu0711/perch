import { describe, expect, test } from 'bun:test';

import { dayBoundsUtc, isValidTimeZone } from '../src/timezone';

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
    [
      '2026-09-11',
      'UTC',
      '2026-09-11T00:00:00.000Z',
      '2026-09-11T23:59:59.999Z',
    ],
    [
      '2026-09-11',
      'Asia/Ho_Chi_Minh',
      '2026-09-10T17:00:00.000Z',
      '2026-09-11T16:59:59.999Z',
    ],
    [
      '2026-03-29',
      'Europe/Berlin',
      '2026-03-28T23:00:00.000Z',
      '2026-03-29T21:59:59.999Z',
    ],
    [
      '2020-03-08',
      'America/Havana',
      '2020-03-08T05:00:00.000Z',
      '2020-03-09T03:59:59.999Z',
    ],
  ];

  test.each(cases)('%s in %s', (day, tz, start, end) => {
    const bounds = dayBoundsUtc(day, tz);
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });
});
