'use client';
import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import type { TemplateIssue } from '@st/core';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import {
  publishTemplateAction,
  saveTemplateDetailsAction,
  templateAction,
  type PublishState,
} from '../actions';

const input = 'h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal';
const label = 'flex flex-col gap-1 text-sm font-medium text-heading';

export function DetailsForm({
  templateId,
  disabled,
  categories,
  types,
  initial,
}: {
  templateId: string;
  disabled: boolean;
  categories: string[];
  types: { value: string; label: string }[];
  initial: {
    title: string;
    description: string;
    category: string;
    documentType: string;
    shared: boolean;
  };
}) {
  const [state, act, pending] = useActionState(
    saveTemplateDetailsAction.bind(null, templateId),
    null,
  );
  return (
    <form action={act} aria-label="Template details">
      <fieldset disabled={disabled || pending} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Template name
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={initial.title}
              className={input}
            />
          </label>
          <label className={label}>
            Category
            <select name="category" defaultValue={initial.category} className={input}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Document type
            <select name="documentType" defaultValue={initial.documentType} className={input}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Description
            <input
              name="description"
              maxLength={500}
              defaultValue={initial.description}
              className={input}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-heading">
          <input type="checkbox" name="shared" defaultChecked={initial.shared} className="size-4" />
          Share with everyone in the workspace who can use templates
        </label>
        <FormStatus state={state} />
        {disabled ? null : (
          <Button type="submit" className="self-start" loading={pending}>
            Save details
          </Button>
        )}
      </fieldset>
    </form>
  );
}

const STEP_HREF: Record<TemplateIssue['step'], string> = {
  recipients: 'roles',
  fields: 'fields',
  settings: 'settings',
};

export function PublishPanel({
  templateId,
  issues,
  canDiscard,
}: {
  templateId: string;
  issues: TemplateIssue[];
  canDiscard: boolean;
}) {
  const [state, setState] = useState<PublishState>(null);
  const [pending, start] = useTransition();
  const [dState, discard, dPending] = useActionState(templateAction.bind(null, templateId), null);
  const shown = state?.issues ?? issues;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {canDiscard
          ? 'You have unpublished changes. Publishing creates a new version; documents already created keep theirs.'
          : 'Publish the template so people can create documents from it.'}
      </p>
      {shown.length ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Before publishing">
          {shown.map((i) => (
            <li key={i.message}>
              <Link
                href={`/app/templates/${templateId}/${STEP_HREF[i.step]}`}
                className="text-error hover:underline"
              >
                {i.message}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {state && !state.issues ? <FormStatus state={state} /> : null}
      <Button
        type="button"
        disabled={pending || shown.length > 0}
        loading={pending}
        onClick={() => start(async () => setState(await publishTemplateAction(templateId)))}
      >
        Publish template
      </Button>
      {canDiscard ? (
        <form action={discard}>
          <input type="hidden" name="intent" value="discard" />
          <Button type="submit" variant="ghost" size="sm" disabled={dPending}>
            Discard unpublished changes
          </Button>
          <FormStatus state={dState} />
        </form>
      ) : null}
    </div>
  );
}

export function ManageTemplate({
  templateId,
  status,
  canEdit,
}: {
  templateId: string;
  status: string;
  canEdit: boolean;
}) {
  const [state, act, pending] = useActionState(templateAction.bind(null, templateId), null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <form action={act}>
        <input type="hidden" name="intent" value="duplicate" />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Duplicate
        </Button>
      </form>
      {canEdit ? (
        <>
          <form action={act}>
            <input
              type="hidden"
              name="intent"
              value={status === 'archived' ? 'unarchive' : 'archive'}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              {status === 'archived' ? 'Restore template' : 'Archive template'}
            </Button>
          </form>
          {confirm ? (
            <form action={act} className="flex flex-col gap-2">
              <input type="hidden" name="intent" value="delete" />
              <p className="text-xs">
                Documents already created from this template are not affected.
              </p>
              <span className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" disabled={pending}>
                  Yes, delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Keep
                </Button>
              </span>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-error"
              onClick={() => setConfirm(true)}
            >
              Delete template
            </Button>
          )}
        </>
      ) : null}
      {state && !state.ok ? (
        <Alert tone="error">{state.message}</Alert>
      ) : (
        <FormStatus state={state} />
      )}
    </div>
  );
}
