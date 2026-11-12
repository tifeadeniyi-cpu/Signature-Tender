'use client';
import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { addCategoryAction } from './actions';

export function AddCategory() {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(addCategoryAction, null);
  if (!open)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden /> Add category
      </Button>
    );
  return (
    <form action={act} aria-label="Add category" className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        Category name
        <input
          name="name"
          required
          maxLength={40}
          className="h-9 rounded-lg border border-border bg-white px-2 text-sm font-normal"
        />
      </label>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
