import { apiErrorSchema } from '@perch/core';
import type { AppType } from '@perch/server';
import type { hc } from 'hono/client';
import { createContext, createElement, type JSX, type ReactNode, useContext } from 'react';

export type ApiClient = ReturnType<typeof hc<AppType>>;

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider(props: { client: ApiClient; children: ReactNode }): JSX.Element {
  return createElement(ApiContext.Provider, { value: props.client }, props.children);
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi() needs an ApiProvider');
  return client;
}

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

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.errors?.[0]?.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

export async function unwrap<T>(responsePromise: Promise<JsonResponse<T>>): Promise<T> {
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
