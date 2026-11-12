'use client';
import { useActionState, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import { contactAction, importAction, saveContactAction } from './actions';

const input = 'h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal';
const label = 'flex flex-col gap-1 text-sm font-medium text-heading';
export const CONTACT_TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  company: 'Company',
  artist: 'Artist',
  venue: 'Venue',
  agent: 'Agent',
  vendor: 'Vendor',
  other: 'Other',
};

type Contact = {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  contactType: string;
  notes: string | null;
  tags: string[];
  visibility: 'shared' | 'private';
};

export function ContactForm({
  contactId,
  initial,
  onDone,
}: {
  contactId: string | null;
  initial?: Contact;
  onDone?: () => void;
}) {
  const [state, act, pending] = useActionState(saveContactAction.bind(null, contactId), null);
  return (
    <form
      action={act}
      aria-label={contactId ? 'Edit contact' : 'Add contact'}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Full name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={initial?.name}
            className={input}
          />
        </label>
        <label className={label}>
          Email
          <input
            name="email"
            type="email"
            required
            defaultValue={initial?.email}
            className={input}
          />
        </label>
        <label className={label}>
          Phone
          <input
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={initial?.phone ?? ''}
            className={input}
          />
        </label>
        <label className={label}>
          Company
          <input
            name="company"
            maxLength={120}
            defaultValue={initial?.company ?? ''}
            className={input}
          />
        </label>
        <label className={label}>
          Job title
          <input
            name="jobTitle"
            maxLength={120}
            defaultValue={initial?.jobTitle ?? ''}
            className={input}
          />
        </label>
        <label className={label}>
          Contact type
          <select
            name="contactType"
            defaultValue={initial?.contactType ?? 'person'}
            className={input}
          >
            {Object.entries(CONTACT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Tags
          <input
            name="tags"
            maxLength={400}
            defaultValue={initial?.tags.join(', ')}
            placeholder="venue, chicago"
            className={input}
          />
        </label>
        <label className={label}>
          Visible to
          <select
            name="visibility"
            defaultValue={initial?.visibility ?? 'shared'}
            className={input}
          >
            <option value="shared">Everyone in the workspace</option>
            <option value="private">Only me</option>
          </select>
        </label>
      </div>
      <label className={label}>
        Notes
        <textarea
          name="notes"
          maxLength={2000}
          rows={3}
          defaultValue={initial?.notes ?? ''}
          className="rounded-lg border border-border px-3 py-2 text-sm font-normal"
        />
      </label>
      <p className="text-xs">Saving a contact does not give them access to any document.</p>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {contactId ? 'Save contact' : 'Add contact'}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Close
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function AddContact() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Add Contact
      </Button>
    );
  return (
    <div className="w-full rounded-2xl border border-border bg-white p-4 shadow-card">
      <ContactForm contactId={null} onDone={() => setOpen(false)} />
    </div>
  );
}

export function ImportContacts() {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(importAction, null);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="size-4" aria-hidden /> Import
      </Button>
    );
  return (
    <form
      action={act}
      aria-label="Import contacts"
      className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-white p-4 shadow-card"
    >
      <label className={label}>
        CSV file
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm font-normal"
        />
      </label>
      <p className="text-xs">
        Needs a header row with Name and Email. Phone, Company, Job title, Type, Tags and Notes are
        optional. Addresses that are already contacts are skipped.
      </p>
      <FormStatus state={state} />
      {state?.result?.skipped.length ? (
        <ul className="max-h-32 overflow-auto text-xs" aria-label="Skipped rows">
          {state.result.skipped.map((s) => (
            <li key={s.row}>
              Row {s.row}: {s.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Import
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function ContactActions({
  contactId,
  archived,
  candidates,
}: {
  contactId: string;
  archived: boolean;
  candidates: { id: string; name: string; email: string }[];
}) {
  const [state, act, pending] = useActionState(contactAction.bind(null, contactId), null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form action={act}>
        <input type="hidden" name="intent" value={archived ? 'unarchive' : 'archive'} />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {archived ? 'Restore contact' : 'Archive contact'}
        </Button>
      </form>
      {candidates.length ? (
        <form action={act} className="flex flex-col gap-2">
          <input type="hidden" name="intent" value="merge" />
          <label className={label}>
            Merge another contact into this one
            <select name="otherId" required className={input} defaultValue="">
              <option value="" disabled>
                Choose a contact
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs">
            Empty details are filled in from the other contact, tags and notes are combined, and the
            other contact is deleted.
          </p>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            Merge
          </Button>
        </form>
      ) : null}
      {confirm ? (
        <form action={act} className="flex gap-2">
          <input type="hidden" name="intent" value="delete" />
          <Button type="submit" variant="danger" size="sm" disabled={pending}>
            Yes, delete
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-error"
          onClick={() => setConfirm(true)}
        >
          Delete contact
        </Button>
      )}
      {state && !state.ok ? (
        <Alert tone="error">{state.message}</Alert>
      ) : (
        <FormStatus state={state} />
      )}
    </div>
  );
}
