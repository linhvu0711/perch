import { describe, expect, test } from 'bun:test';

import { parseScheduleTime } from '../src/schedule';
import { zonedParts } from '../src/timezone';

const NOW = new Date('2026-09-04T10:00:00Z'); // Friday 17:00 in Asia/Ho_Chi_Minh

describe('parseScheduleTime', () => {
  const cases: Array<[string, string]> = [
    ['2026-09-10T09:00', '2026-09-10T02:00:00.000Z'],
    ['2026-09-10T09:00:00Z', '2026-09-10T09:00:00.000Z'],
    ['2026-09-10T09:00+07:00', '2026-09-10T02:00:00.000Z'],
    ['2026-09-10 09:00', '2026-09-10T02:00:00.000Z'],
    ['+2h', '2026-09-04T12:00:00.000Z'],
    ['+30m', '2026-09-04T10:30:00.000Z'],
    ['+1d', '2026-09-05T10:00:00.000Z'],
    ['today 18:00', '2026-09-04T11:00:00.000Z'],
    ['tomorrow 9am', '2026-09-05T02:00:00.000Z'],
    ['tomorrow 12am', '2026-09-04T17:00:00.000Z'],
    ['tomorrow 12pm', '2026-09-05T05:00:00.000Z'],
    ['friday 9am', '2026-09-11T02:00:00.000Z'],
    ['next friday 9am', '2026-09-11T02:00:00.000Z'],
    ['Mon 7pm', '2026-09-07T12:00:00.000Z'],
    ['monday 14:30', '2026-09-07T07:30:00.000Z'],
    ['2026-09-10T09:00:45Z', '2026-09-10T09:00:00.000Z'],
  ];

  test.each(cases)('parses every form in Asia/Ho_Chi_Minh: %s', (input, expected) => {
    const parsed = parseScheduleTime(input, 'Asia/Ho_Chi_Minh', NOW);
    if (parsed === null) throw new Error('parsed is null');
    expect(parsed.toISOString()).toBe(expected);
  });

  const berlin: Array<[string, string]> = [
    ['2026-03-29 02:30', '2026-03-29T01:30:00.000Z'],
    ['2026-10-25 02:30', '2026-10-25T01:30:00.000Z'],
    ['2026-03-29 01:30', '2026-03-29T00:30:00.000Z'],
    ['2026-10-25 04:00', '2026-10-25T03:00:00.000Z'],
  ];

  test.each(berlin)('handles DST edges in Europe/Berlin: %s', (input, expected) => {
    const parsed = parseScheduleTime(input, 'Europe/Berlin', NOW);
    if (parsed === null) throw new Error('parsed is null');
    expect(parsed.toISOString()).toBe(expected);
  });

  const unknown = [
    'soon',
    '',
    '2026-13-01 09:00',
    '2026-02-30 09:00',
    'tomorrow',
    '+2w',
    '+h',
    'today 25:00',
    'friday',
    '2026-09-10 9:00',
    '2026-09-10 99:99',
    'monkey 9am',
    'thursdayish 9am',
  ];

  test.each(unknown)('rejects what it does not know: %s', (input) => {
    expect(parseScheduleTime(input, 'UTC', NOW)).toBeNull();
  });
});

test('zonedParts round-trips', () => {
  expect(zonedParts(new Date('2026-09-10T02:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toEqual({
    date: '2026-09-10',
    time: '09:00',
    weekday: 4,
  });
});
