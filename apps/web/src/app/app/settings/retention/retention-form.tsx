'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { retentionPolicyAction } from '@/app/app/documents/library-actions';

export function RetentionRuleForm({
  label,
  documentType,
  days,
  placeholder,
  minDays,
  canManage,
}: {
  label: string;
  documentType: string;
  days: number | null;
  placeholder: string;
  minDays: number;
  canManage: boolean;
}) {
  const [state, act, pending] = useActionState(retentionPolicyAction, null);
  const id = `retain-${documentType || 'default'}`;
  return (
    <form action={act} className="flex flex-wrap items-end gap-3 py-3">
      <input type="hidden" name="documentType" value={documentType} />
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-heading">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            name="days"
            type="number"
            inputMode="numeric"
            min={minDays}
            max={36500}
            defaultValue={days ?? ''}
            placeholder={placeholder}
            disabled={!canManage}
            aria-describedby={`${id}-msg`}
            className="h-10 w-32 rounded-lg border border-border bg-white px-3 text-sm disabled:bg-blush/40"
          />
          <span className="text-sm">days</span>
        </div>
      </div>
      {canManage ? (
        <div className="flex gap-2">
          <Button type="submit" size="sm" name="intent" value="save" loading={pending}>
            Save
          </Button>
          {days !== null ? (
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              name="intent"
              value="remove"
              disabled={pending}
            >
              Use default
            </Button>
          ) : null}
        </div>
      ) : null}
      <p
        id={`${id}-msg`}
        role={state && !state.ok ? 'alert' : 'status'}
        className={`w-full text-xs ${state?.ok ? 'text-success' : 'text-error'}`}
      >
        {state?.message ?? ''}
      </p>
    </form>
  );
}
