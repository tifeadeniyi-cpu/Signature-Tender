'use client';
import type { ActionState } from '@/lib/action-result';
import { Alert } from './feedback';

export function FormStatus({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>;
}
