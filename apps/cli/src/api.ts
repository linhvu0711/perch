import { apiErrorSchema } from '@perch/core';
import type { AppType } from '@perch/server';
import { hc } from 'hono/client';

import type { CliContext } from './context';
import { CliError } from './output';

interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

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
    async call<T>(responsePromise: Promise<JsonResponse<T>>): Promise<T> {
      let response: JsonResponse<T>;
      try {
        response = await responsePromise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          'unreachable',
          `Cannot reach ${serverUrl}: ${message}`,
        );
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new CliError(
            'bad_response',
            `Server at ${serverUrl} did not return JSON`,
          );
        }
      }

      try {
        const parsed = apiErrorSchema.safeParse(await response.json());
        if (parsed.success) {
          throw new CliError(
            parsed.data.code,
            parsed.data.message,
            parsed.data.code === 'unauthorized' ? 3 : 1,
            parsed.data.errors,
          );
        }
      } catch (error) {
        if (error instanceof CliError) throw error;
      }

      throw new CliError('http_error', `HTTP ${response.status}`);
    },
  };
}
