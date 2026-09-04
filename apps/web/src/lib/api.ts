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
    public errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

export async function unwrap<T>(
  responsePromise: Promise<JsonResponse<T>>,
): Promise<T> {
  const response = await responsePromise;
  if (response.ok) return response.json();

  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      throw new ApiError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.errors,
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }

  throw new ApiError(response.status, 'http_error', `HTTP ${response.status}`);
}
