import { apiErrorSchema } from '@perch/core';
import type { AppType } from '@perch/server';
import { hc } from 'hono/client';

export const api = hc<AppType>('/', {
  init: { credentials: 'same-origin' },
});

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function unwrap<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await responsePromise;
  if (response.ok) return (await response.json()) as T;

  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.code, parsed.data.message);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }

  throw new ApiError(response.status, 'http_error', `HTTP ${response.status}`);
}
