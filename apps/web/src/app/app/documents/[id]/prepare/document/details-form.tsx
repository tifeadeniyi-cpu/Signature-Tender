'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/action-result';
import { TextField, SelectField } from '@/components/ui/field';
import { Button, buttonClass } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';

export function DetailsForm({
  action,
  title,
  documentType,
  types,
  disabled,
  nextHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  title: string;
  documentType: string;
  types: { value: string; label: string }[];
  disabled: boolean;
  nextHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <TextField
          label="Document name"
          name="title"
          defaultValue={title}
          required
          maxLength={200}
          error={state?.fieldErrors?.title}
        />
        <SelectField
          label="Document type"
          name="documentType"
          defaultValue={documentType}
          error={state?.fieldErrors?.documentType}
        >
          <option value="">Select type</option>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
      </fieldset>
      <FormStatus state={state} />
      <div className="flex flex-wrap justify-between gap-2">
        {!disabled ? (
          <Button type="submit" variant="secondary" loading={pending}>
            Save
          </Button>
        ) : (
          <span />
        )}
        <Link href={nextHref} className={buttonClass('primary')}>
          Next: Signers
        </Link>
      </div>
    </form>
  );
}
