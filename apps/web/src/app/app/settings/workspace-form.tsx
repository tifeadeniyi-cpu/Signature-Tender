'use client';
import { useActionState } from 'react';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { saveWorkspace } from './actions';

export function WorkspaceForm({
  initial,
  canEdit,
}: {
  initial: { name: string; legalName: string; contactEmail: string; website: string };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveWorkspace, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Organization information</legend>
        <TextField
          label="Workspace name"
          name="name"
          defaultValue={initial.name}
          required
          maxLength={120}
          error={fe.name}
        />
        <TextField
          label="Organization email"
          name="contactEmail"
          type="email"
          defaultValue={initial.contactEmail}
          error={fe.contactEmail}
          autoComplete="email"
        />
        <TextField
          label="Business name"
          name="legalName"
          defaultValue={initial.legalName}
          error={fe.legalName}
          hint="Legal name shown on receipts and certificates"
        />
        <TextField
          label="Website"
          name="website"
          type="url"
          defaultValue={initial.website}
          error={fe.website}
          placeholder="https://"
        />
      </fieldset>
      <FormStatus state={state} />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Save Changes
          </Button>
        </div>
      ) : (
        <p className="text-sm">Only owners and admins can change workspace settings.</p>
      )}
    </form>
  );
}
