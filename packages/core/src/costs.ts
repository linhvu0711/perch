export const X_COSTS_USD = {
  getMe: 0.01,
  getTweet: 0.005,
  publish: 0.015,
  publishWithUrl: 0.2,
  mediaUpload: 0,
} as const;

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(3)}`;
}

export const X_ENDPOINTS = {
  getMe: 'GET /2/users/me',
  getTweet: 'GET /2/tweets/:id',
  createPost: 'POST /2/tweets',
  uploadMedia: 'POST /2/media/upload',
} as const;
