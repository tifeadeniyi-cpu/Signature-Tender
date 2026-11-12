'use client';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, PenLine } from 'lucide-react';
import { PdfPages } from '@/components/documents/pdf-pages';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { adoptAction, completeAction } from './actions';
import { SignatureModal, type Adopted, type Font } from './signature-modal';
import { DeclineForm } from './stages';

type Field = {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
  options: string[] | null;
};
type Mark = { id: string; dataUrl: string };
type Data = {
  pageCount: number;
  role: string;
  name: string;
  email: string;
  fields: Field[];
  signatures: { id: string; kind: string; method: string; dataUrl: string }[];
};

const today = () => new Date().toISOString().slice(0, 10);

export function SigningWorkspace({
  token,
  title,
  senderName,
  isTest,
  data,
  fonts,
}: {
  token: string;
  title: string;
  senderName: string;
  isTest: boolean;
  data: Data;
  fonts: Font[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.fields.map((f) => [
        f.id,
        f.type === 'name'
          ? data.name
          : f.type === 'email'
            ? data.email
            : f.type === 'checkbox'
              ? 'false'
              : '',
      ]),
    ),
  );
  const [applied, setApplied] = useState<Record<string, Mark>>({});
  const [marks, setMarks] = useState<{ signature?: Mark; initials?: Mark }>(() => ({
    signature: data.signatures.find((s) => s.kind === 'signature'),
    initials: data.signatures.find((s) => s.kind === 'initials'),
  }));
  const [modal, setModal] = useState<{ kind: 'signature' | 'initials'; fieldId: string } | null>(
    null,
  );
  const [modalError, setModalError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [intent, setIntent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const verb =
    data.role === 'reviewer' ? 'review' : data.role === 'approver' ? 'approval' : 'signing';
  const done = useCallback(
    (f: Field) => {
      if (f.type === 'date_signed') return true;
      if (f.type === 'signature' || f.type === 'initials') return Boolean(applied[f.id]);
      if (f.type === 'checkbox') return values[f.id] === 'true';
      return Boolean(values[f.id]?.trim());
    },
    [applied, values],
  );
  const required = useMemo(
    () => data.fields.filter((f) => f.required && f.type !== 'date_signed'),
    [data.fields],
  );
  const remaining = required.filter((f) => !done(f));

  function goNext() {
    const next = remaining[0];
    if (!next) return;
    const el = document.getElementById(`field-${next.id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el?.focus(), 350);
  }

  function clickMark(f: Field) {
    const kind = f.type as 'signature' | 'initials';
    const existing = marks[kind];
    if (existing && !applied[f.id]) {
      setApplied((a) => ({ ...a, [f.id]: existing }));
      return;
    }
    setModalError(null);
    setModal({ kind, fieldId: f.id });
  }

  function adopt(a: Adopted) {
    if (!modal) return;
    const { kind, fieldId } = modal;
    start(async () => {
      const r = await adoptAction(token, { kind, ...a }).catch(() => ({
        ok: false as const,
        message: 'Connection problem. Please try again.',
      }));
      if (!r.ok) return setModalError(r.message);
      const mark = { id: r.id, dataUrl: r.dataUrl };
      setMarks((m) => ({ ...m, [kind]: mark }));
      // A newly adopted mark replaces the earlier one in every field of that kind already applied.
      setApplied((prev) => {
        const next = { ...prev, [fieldId]: mark };
        for (const f of data.fields) if (f.type === kind && prev[f.id]) next[f.id] = mark;
        return next;
      });
      setModal(null);
    });
  }

  function finish() {
    setError(null);
    start(async () => {
      const r = await completeAction(token, {
        intent: true,
        values: data.fields
          .filter((f) => f.type !== 'date_signed')
          .map((f) =>
            f.type === 'signature' || f.type === 'initials'
              ? { fieldId: f.id, signatureId: applied[f.id]?.id ?? null }
              : { fieldId: f.id, value: values[f.id] ?? '' },
          ),
      });
      if (r?.ok) router.refresh();
      else {
        setError(r?.message ?? 'Something went wrong.');
        setConfirming(false);
      }
    });
  }

  const overlay = (page: number, size: { width: number; height: number }) =>
    data.fields
      .filter((f) => f.page === page)
      .map((f) => {
        const style = {
          left: f.x * size.width,
          top: f.y * size.height,
          width: f.width * size.width,
          height: f.height * size.height,
        };
        const fs = Math.max(10, Math.min(16, style.height * 0.55));
        const isDone = done(f);
        const ring = cn(
          'absolute rounded border-2 transition-colors',
          isDone
            ? 'border-success/60 bg-success-bg/40'
            : f.required
              ? 'border-primary bg-primary-surface/70'
              : 'border-slate-400/60 bg-white/70',
        );
        const label = `${f.label || f.type.replace('_', ' ')}${f.required ? ' (required)' : ' (optional)'}`;
        if (f.type === 'signature' || f.type === 'initials') {
          const mark = applied[f.id];
          return (
            <button
              key={f.id}
              id={`field-${f.id}`}
              type="button"
              style={style}
              className={cn(ring, 'flex items-center justify-center overflow-hidden')}
              onClick={() => clickMark(f)}
              aria-label={
                mark
                  ? `${f.type === 'initials' ? 'Initials' : 'Signature'} applied. Select to change.`
                  : `Add your ${f.type === 'initials' ? 'initials' : 'signature'}${f.required ? ' (required)' : ''}`
              }
            >
              {mark ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mark.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                  <PenLine className="size-3.5" aria-hidden />{' '}
                  {f.type === 'initials' ? 'Initial' : 'Sign'}
                </span>
              )}
            </button>
          );
        }
        if (f.type === 'date_signed') {
          return (
            <div
              key={f.id}
              id={`field-${f.id}`}
              style={{ ...style, fontSize: fs }}
              className="absolute flex items-center rounded border border-dashed border-slate-400 bg-white/70 px-1 text-heading"
              aria-label={`Date signed, filled automatically: ${today()}`}
            >
              {today()}
            </div>
          );
        }
        if (f.type === 'checkbox') {
          return (
            <label
              key={f.id}
              style={style}
              className={cn(ring, 'flex items-center justify-center')}
            >
              <span className="sr-only">{label}</span>
              <input
                id={`field-${f.id}`}
                type="checkbox"
                checked={values[f.id] === 'true'}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.checked ? 'true' : 'false' }))
                }
                className="size-full max-h-5 max-w-5"
              />
            </label>
          );
        }
        if (f.type === 'dropdown' || f.type === 'radio') {
          return (
            <select
              key={f.id}
              id={`field-${f.id}`}
              aria-label={label}
              style={{ ...style, fontSize: fs }}
              value={values[f.id]}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
              className={cn(ring, 'px-1 text-heading')}
            >
              <option value="">Choose…</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }
        return (
          <input
            key={f.id}
            id={`field-${f.id}`}
            aria-label={label}
            placeholder={f.label ?? ''}
            type={f.type === 'email' ? 'email' : 'text'}
            inputMode={f.type === 'number' ? 'decimal' : undefined}
            maxLength={500}
            style={{ ...style, fontSize: fs }}
            value={values[f.id]}
            onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
            className={cn(
              ring,
              'px-1 text-heading placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-hover',
            )}
          />
        );
      });

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-heading">{title}</p>
            <p className="text-xs" aria-live="polite">
              {required.length === 0
                ? data.role === 'reviewer'
                  ? 'Read the document, then finish your review.'
                  : 'No required fields for you.'
                : `${required.length - remaining.length} of ${required.length} required ${required.length === 1 ? 'field' : 'fields'} complete`}
            </p>
          </div>
          {remaining.length ? (
            <Button type="button" variant="secondary" size="sm" onClick={goNext}>
              <ArrowDown className="size-4" aria-hidden /> Next required field
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={remaining.length > 0 || pending}
            onClick={() => setConfirming(true)}
          >
            Finish {verb}
          </Button>
        </div>
        {isTest ? (
          <p className="mx-auto mt-2 max-w-5xl text-xs font-semibold text-warning">
            Test request. Not for real agreements.
          </p>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-5xl px-2 py-6 sm:px-4">
        {error ? (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <p className="mb-4 px-2 text-sm">
          From {senderName}. Read the whole document. Fields for you are highlighted.
        </p>
        <div className="rounded-2xl bg-primary-surface/50 p-2 pb-8 sm:p-4">
          <PdfPages src={`/api/sign/${token}/file`} overlay={overlay} />
        </div>
        <div className="mt-6 flex flex-col items-center gap-2">
          <DeclineForm token={token} compact />
        </div>
      </div>

      {modal ? (
        <SignatureModal
          kind={modal.kind}
          name={data.name}
          fonts={fonts}
          onAdopt={adopt}
          onClose={() => setModal(null)}
          error={modalError}
          busy={pending}
        />
      ) : null}

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-heading/50 sm:items-center sm:p-4"
          onClick={() => setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-title"
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-card sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="finish-title" className="font-display text-2xl">
              Finish {verb}
            </h2>
            <label className="mt-4 flex items-start gap-3 text-sm text-heading">
              <input
                type="checkbox"
                checked={intent}
                onChange={(e) => setIntent(e.target.checked)}
                className="mt-0.5 size-4"
                autoFocus
              />
              {data.role === 'reviewer'
                ? `I have reviewed "${title}".`
                : data.role === 'approver'
                  ? `I have reviewed "${title}" and I approve it.`
                  : `I have reviewed "${title}" and I intend to sign it electronically with the marks I applied.`}
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Go back
              </Button>
              <Button type="button" disabled={!intent} loading={pending} onClick={finish}>
                {data.role === 'signer' ? 'Sign document' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
