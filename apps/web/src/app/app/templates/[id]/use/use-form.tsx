'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { useTemplateAction } from '../../actions';

const input = 'h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal';
const label = 'flex flex-col gap-1 text-sm font-medium text-heading';

export function UseTemplateForm({
  templateId,
  defaultTitle,
  roles,
  contacts,
}: {
  templateId: string;
  defaultTitle: string;
  roles: { id: string; label: string; action: string }[];
  contacts: { name: string; email: string }[];
}) {
  const [state, act, pending] = useActionState(useTemplateAction.bind(null, templateId), null);
  return (
    <form action={act} aria-label="Use template" className="flex flex-col gap-4">
      <label className={label}>
        Document name
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={defaultTitle}
          className={input}
        />
      </label>
      {contacts.length ? (
        <datalist id="contact-emails">
          {contacts.map((c) => (
            <option key={c.email} value={c.email}>
              {c.name}
            </option>
          ))}
        </datalist>
      ) : null}
      {roles.map((r) => (
        <fieldset key={r.id} className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-heading">
            {r.label} <span className="font-normal">({r.action})</span>
          </legend>
          <input type="hidden" name="placeholderId" value={r.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              {r.label} name
              <input
                name={`name_${r.id}`}
                required
                maxLength={120}
                autoComplete="off"
                className={input}
              />
            </label>
            <label className={label}>
              {r.label} email
              <input
                name={`email_${r.id}`}
                type="email"
                required
                list="contact-emails"
                autoComplete="off"
                className={input}
              />
            </label>
          </div>
        </fieldset>
      ))}
      <p className="text-xs">
        This creates a draft document. Nothing is sent until you review it and choose Send.
      </p>
      <FormStatus state={state} />
      <Button type="submit" className="self-start" loading={pending}>
        Create document
      </Button>
    </form>
  );
}
