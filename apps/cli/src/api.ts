import { apiErrorSchema } from '@perch/core';
import type { AppType } from '@perch/server';
import { hc } from 'hono/client';

import type { CliContext } from './context';
import { CliError } from './output';

export function createApi(
  ctx: CliContext,
  serverUrl: string,
  token: string | undefined,
) {
  const client = hc<AppType>(serverUrl, {
    fetch: ctx.fetch,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return {
    client,
    async call<T>(fn: () => Promise<Response>): Promise<T> {
      let response: Response;
      try {
        response = await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          'unreachable',
          `Cannot reach ${serverUrl}: ${message}`,
        );
      }

      if (response.ok) return (await response.json()) as T;

      try {
        const parsed = apiErrorSchema.safeParse(await response.json());
        if (parsed.success) {
          throw new CliError(
            parsed.data.code,
            parsed.data.message,
            parsed.data.code === 'unauthorized' ? 3 : 1,
          );
        }
      } catch (error) {
        if (error instanceof CliError) throw error;
      }

      throw new CliError('http_error', `HTTP ${response.status}`);
    },
  };
}
