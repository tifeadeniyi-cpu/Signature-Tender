import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '@st/core';

const STATUS: Record<AppError['code'], number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 422,
  conflict: 409,
  unauthenticated: 401,
};

/** Maps known errors to JSON responses; unknown errors are logged and returned as a generic 500. */
export function apiError(err: unknown) {
  if (err instanceof AppError)
    return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
  if (err instanceof ZodError)
    return NextResponse.json(
      { error: err.issues[0]?.message ?? 'Invalid input', code: 'invalid' },
      { status: 422 },
    );
  console.error(err);
  return NextResponse.json(
    { error: 'Something went wrong. Please try again.', code: 'server_error' },
    { status: 500 },
  );
}
