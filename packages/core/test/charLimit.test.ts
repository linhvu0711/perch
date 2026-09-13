import { describe, expect, test } from 'bun:test';

import { charLimitForPlan, effectiveCharLimit } from '../src/charLimit';

describe('charLimitForPlan', () => {
  test.each([
    ['Premium', 25000],
    ['PremiumPlus', 25000],
    ['Basic', 280],
    ['None', 280],
    [null, 280],
  ] as const)('%s → %s', (plan, expected) => {
    expect(charLimitForPlan(plan)).toBe(expected);
  });
});

describe('effectiveCharLimit', () => {
  test.each([
    [500, 'Premium', 500],
    [null, 'Premium', 25000],
    [null, 'Basic', 280],
    [null, null, 280],
  ] as const)('override %s, plan %s → %s', (override, plan, expected) => {
    expect(effectiveCharLimit(override, plan)).toBe(expected);
  });
});
