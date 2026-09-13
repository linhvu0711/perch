import { describe, expect, test } from 'bun:test';

import { estimateCost } from '../src/cost';
import { costKindOf, costSummaryQuerySchema, X_COSTS_USD } from '../src/costs';

describe('costKindOf', () => {
  test('costKindOf maps every logged endpoint', () => {
    // Given: nothing
    // When
    // Then
    expect(costKindOf('POST /2/tweets')).toBe('publish');
    expect(costKindOf('POST /2/media/upload')).toBe('publish');
    expect(costKindOf('GET /2/tweets/:id')).toBe('save_tweet');
    expect(costKindOf('GET /2/users/me')).toBe('connect');
    expect(() => costKindOf('GET /2/nope')).toThrow();
  });
});

describe('estimateCost', () => {
  test('estimateCost reads the price table', () => {
    // Given: nothing
    // When
    // Then
    expect(estimateCost('Hello')).toBe(X_COSTS_USD.publish);
    expect(estimateCost('see https://example.com')).toBe(X_COSTS_USD.publishWithUrl);
  });
});

describe('costSummaryQuerySchema', () => {
  test('month query accepts YYYY-MM only', () => {
    // Given: nothing
    // When
    // Then
    expect(costSummaryQuerySchema.safeParse({ month: '2026-09' }).success).toBe(true);
    expect(costSummaryQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(costSummaryQuerySchema.safeParse({ month: '2026-9' }).success).toBe(false);
    expect(costSummaryQuerySchema.safeParse({ month: '2026-09-01' }).success).toBe(false);
  });
});
