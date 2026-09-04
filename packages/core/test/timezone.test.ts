import { describe, expect, test } from 'bun:test';

import { isValidTimeZone } from '../src/timezone';

describe('isValidTimeZone', () => {
  test.each(['UTC', 'Asia/Ho_Chi_Minh', 'Europe/Berlin'])('accepts %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });

  test.each(['', 'Mars/Olympus', 'utc '])('rejects %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});
