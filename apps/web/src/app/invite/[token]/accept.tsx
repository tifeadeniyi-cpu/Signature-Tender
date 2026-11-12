'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { acceptInviteAction } from '@/app/app/team/actions';

export function AcceptInvite({ token }: { token: string }) {
  const [state, act, pending] = useActionState(acceptInviteAction.bind(null, token), null);
  return (
    <form action={act} className="mt-5 flex flex-col gap-3">
      <Button type="submit" loading={pending}>
        Accept invitation
      </Button>
      <FormStatus state={state} />
    </form>
  );
}
