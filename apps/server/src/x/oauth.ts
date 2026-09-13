import { createHash, randomBytes } from 'node:crypto';

import type { Clock } from '../clock';

export const X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'offline.access',
];

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface XOAuthConfig {
  clientId: string;
  redirectUri: string;
  authorizeUrl: string;
}

export function createPkce(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(
  config: XOAuthConfig,
  input: { state: string; codeChallenge: string },
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', X_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

interface StateEntry {
  userId: number;
  codeVerifier: string;
  createdAt: number;
}

export function createStateStore(clock: Clock) {
  const states = new Map<string, StateEntry>();

  return {
    put(input: { userId: number; codeVerifier: string }): string {
      const state = randomBytes(32).toString('base64url');
      states.set(state, { ...input, createdAt: clock.now().getTime() });
      return state;
    },
    take(state: string): { userId: number; codeVerifier: string } | null {
      const now = clock.now().getTime();
      for (const [key, candidate] of states) {
        if (now - candidate.createdAt > OAUTH_STATE_TTL_MS) {
          states.delete(key);
        }
      }
      const entry = states.get(state);
      states.delete(state);
      if (!entry) return null;
      if (clock.now().getTime() - entry.createdAt > OAUTH_STATE_TTL_MS) {
        return null;
      }
      return { userId: entry.userId, codeVerifier: entry.codeVerifier };
    },
  };
}
