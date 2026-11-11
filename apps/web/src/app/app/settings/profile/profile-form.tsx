'use client';
import { useActionState } from 'react';
import { TextField, SelectField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { saveProfile } from '../actions';

export function ProfileForm({
  initial,
  timezones,
}: {
  initial: { name: string; email: string; jobTitle: string; phone: string; timezone: string };
  timezones: string[];
}) {
  const [state, action, pending] = useActionState(saveProfile, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Profile</legend>
        <TextField
          label="Full name"
          name="name"
          defaultValue={initial.name}
          required
          autoComplete="name"
          error={fe.name}
        />
        <TextField
          label="Email"
          name="email"
          defaultValue={initial.email}
          readOnly
          hint="Email changes will be supported with re-verification later."
        />
        <TextField
          label="Job title"
          name="jobTitle"
          defaultValue={initial.jobTitle}
          autoComplete="organization-title"
          error={fe.jobTitle}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={initial.phone}
          autoComplete="tel"
          error={fe.phone}
        />
        <SelectField
          label="Time zone"
          name="timezone"
          defaultValue={initial.timezone}
          error={fe.timezone}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll('_', ' ')}
            </option>
          ))}
        </SelectField>
      </fieldset>
      <FormStatus state={state} />
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Save Profile
        </Button>
      </div>
    </form>
  );
}
