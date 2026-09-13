import { expect, test } from 'bun:test';

import { formatUsd, X_COSTS_USD } from '../src/costs';

test('formats a cost with three decimals', () => {
  // Given: core costs
  // When
  const getMe = formatUsd(X_COSTS_USD.getMe);
  const twentyCents = formatUsd(0.2);
  // Then
  expect(getMe).toBe('$0.010');
  expect(twentyCents).toBe('$0.200');
});
