import { ZodError } from 'zod';
import { AppError } from '@st/core';

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

/** Converts validation and permission errors into a form-friendly result. Unknown errors are rethrown. */
export function toActionError(err: unknown): ActionState {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = String(issue.path[0] ?? 'form');
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors };
  }
  if (err instanceof AppError) return { ok: false, message: err.message };
  throw err;
}

/** Like toActionError, for forms that show no inline field errors: the first problem becomes the message. */
export function toFormError(err: unknown): ActionState {
  const r = toActionError(err);
  const first = r?.fieldErrors && Object.values(r.fieldErrors)[0];
  return first ? { ok: false, message: first } : r;
}
