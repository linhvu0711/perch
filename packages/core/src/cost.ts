import twitter from 'twitter-text';

import { X_COSTS_USD } from './costs';

const { extractUrlsWithIndices } = twitter;

/** Estimated X API cost of a post; only http(s) URLs raise the price. */
export function estimateCost(text: string): number {
  return extractUrlsWithIndices(text).some((entity) => /^https?:\/\//i.test(entity.url))
    ? X_COSTS_USD.publishWithUrl
    : X_COSTS_USD.publish;
}

/** USD cost as `$x.xxx`. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(3)}`;
}
