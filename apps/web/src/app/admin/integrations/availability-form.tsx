'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setAvailabilityAction } from './actions';

export function AvailabilityForm({
  provider,
  name,
  current,
  locked,
}: {
  provider: string;
  name: string;
  current: string;
  locked: boolean;
}) {
  const [state, act, pending] = useActionState(setAvailabilityAction, null);
  return (
    <form action={act} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="provider" value={provider} />
      <label className="sr-only" htmlFor={`av-${provider}`}>
        Availability for {name}
      </label>
      <select
        id={`av-${provider}`}
        name="availability"
        defaultValue={current}
        disabled={locked}
        className="h-8 rounded-lg border border-border bg-white px-2 text-sm"
      >
        <option value="default">Default</option>
        <option value="available">Available</option>
        <option value="beta">Beta</option>
        <option value="maintenance">Maintenance</option>
        <option value="unavailable">Unavailable</option>
        <option value="coming_soon">Coming Soon</option>
      </select>
      {locked ? null : (
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Save
        </Button>
      )}
      {state ? (
        <span role="status" className={`text-xs ${state.ok ? 'text-success' : 'text-error'}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
