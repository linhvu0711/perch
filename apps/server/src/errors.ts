import type { Context, ErrorHandler, NotFoundHandler } from 'hono';

type ValidationResult =
  | { success: true }
  | {
      success: false;
      error: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };

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
