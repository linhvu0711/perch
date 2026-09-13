import twitter from 'twitter-text';

const { extractUrlsWithIndices } = twitter;

export const COST_POST_USD = 0.015;
export const COST_POST_WITH_URL_USD = 0.2;

/** Estimated X API cost of a post; only http(s) URLs raise the price. */
export function estimateCost(text: string): number {
  return extractUrlsWithIndices(text).some((entity) => /^https?:\/\//i.test(entity.url))
    ? COST_POST_WITH_URL_USD
    : COST_POST_USD;
}

/** USD cost as `$x.xxx`. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(3)}`;
}
