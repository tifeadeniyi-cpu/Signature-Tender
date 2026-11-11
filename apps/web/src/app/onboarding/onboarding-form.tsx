'use client';
import { useActionState } from 'react';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { createWorkspaceAction } from '../app/settings/actions';

export function OnboardingForm({ suggested }: { suggested: string }) {
  const [state, action, pending] = useActionState(createWorkspaceAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <TextField
        label="Workspace name"
        name="name"
        defaultValue={suggested}
        required
        maxLength={120}
        error={state?.fieldErrors?.name}
        autoFocus
      />
      <FormStatus state={state} />
      <Button type="submit" size="lg" loading={pending}>
        Create workspace
      </Button>
    </form>
  );
}
