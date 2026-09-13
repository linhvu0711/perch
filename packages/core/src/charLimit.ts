export const CHAR_LIMIT_DEFAULT = 280;
export const CHAR_LIMIT_MAX = 25_000;
export const CHAR_LIMIT_PREMIUM = 25_000;

export function charLimitForPlan(subscriptionType: string | null): number {
  if (subscriptionType === 'Premium' || subscriptionType === 'PremiumPlus') {
    return CHAR_LIMIT_PREMIUM;
  }
  return CHAR_LIMIT_DEFAULT;
}

export function effectiveCharLimit(
  override: number | null,
  subscriptionType: string | null,
): number {
  return override ?? charLimitForPlan(subscriptionType);
}
