import type { Context, ErrorHandler, NotFoundHandler } from 'hono';

type ValidationResult =
  | { success: true }
  | {
      success: false;
      error: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };

export type DomainCode =
  | 'validation'
  | 'invalid_status'
  | 'not_found'
  | 'in_flight'
  | 'reconnect_required'
  | 'publish_failed'
  | 'not_configured'
  | 'token_refresh_failed';

export const DOMAIN_STATUS = {
  validation: 400,
  invalid_status: 400,
  not_found: 404,
  in_flight: 409,
  reconnect_required: 409,
  publish_failed: 502,
  not_configured: 503,
  token_refresh_failed: 503,
} as const satisfies Record<DomainCode, 400 | 404 | 409 | 502 | 503>;

export class DomainError extends Error {
  constructor(
    public code: DomainCode,
    public path: string | null,
    message: string,
    public errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export function notFound(name: string, id: number): ApiError {
  return new ApiError(404, 'not_found', `${name} ${id} not found`);
}

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 500 | 502 | 503,
    public code:
      | 'validation'
      | 'unauthorized'
      | 'not_found'
      | 'reconnect_required'
      | 'internal'
      | 'not_configured'
      | 'publish_failed'
      | 'in_flight'
      | 'token_refresh_failed',
    message: string,
    public errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof DomainError) {
    const status = DOMAIN_STATUS[error.code];
    if (status === 400) {
      const errors =
        error.errors ?? (error.path === null ? [] : [{ path: error.path, message: error.message }]);
      return c.json({ code: 'validation', message: 'Invalid request', errors }, 400);
    }
    return c.json({ code: error.code, message: error.message }, status);
  }

  if (error instanceof ApiError) {
    const body = error.errors
      ? { code: error.code, message: error.message, errors: error.errors }
      : { code: error.code, message: error.message };
    return c.json(body, error.status);
  }

  console.error(error);
  return c.json({ code: 'internal', message: 'Internal error' }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    {
      code: 'not_found',
      message: `No route for ${c.req.method} ${c.req.path}`,
    },
    404,
  );

export function validationHook(result: ValidationResult, _c: Context): void {
  if (!result.success) {
    throw new ApiError(
      400,
      'validation',
      'Invalid request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}
