export const X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'offline.access',
];

export interface XOAuthConfig {
  clientId: string;
  redirectUri: string;
  authorizeUrl: string;
}
