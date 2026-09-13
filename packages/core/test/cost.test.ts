import { describe, expect, test } from 'bun:test';

import { estimateCost, formatCost } from '../src/cost';

describe('estimateCost', () => {
  const cases: Array<[string, number]> = [
    ['Hello', 0.015],
    ['see https://example.com', 0.2],
    ['HTTPS://EXAMPLE.COM/x', 0.2],
    ['http://x.com/@a#b', 0.2],
    ['go to example.com', 0.015],
    ['@bob', 0.015],
    ['#news', 0.015],
    ['', 0.015],
  ];

  test.each(cases)('%p -> %p', (text, expected) => {
    expect(estimateCost(text)).toBe(expected);
  });
});

describe('formatCost', () => {
  const cases: Array<[number, string]> = [
    [0.015, '$0.015'],
    [0.2, '$0.200'],
  ];

  test.each(cases)('%p -> %p', (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });
});
