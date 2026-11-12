'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Signature,
  Type,
  CalendarDays,
  UserRound,
  Mail,
  TextCursorInput,
  SquareCheck,
  ChevronDown,
  CircleDot,
  Hash,
  Trash2,
  Copy,
} from 'lucide-react';
import type { FieldType } from '@st/core';
import type { ActionState } from '@/lib/action-result';
import { PdfPages } from '@/components/documents/pdf-pages';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import { colorFor } from '@/components/documents/colors';
import { cn } from '@/lib/cn';

type Field = {
  id: string;
  recipientId: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
  options: string[] | null;
};
type Recipient = { id: string; name: string; colorIndex: number };
export type FieldInput = Omit<Field, 'id'>;
export interface EditorNav {
  /** Saves the fields (a bound server action). */
  onSave: (fields: FieldInput[]) => Promise<ActionState>;
  fileSrc: string;
  backHref: string;
  nextHref: string;
  nextLabel: string;
}

const PALETTE: { type: FieldType; label: string; Icon: typeof Type; w: number; h: number }[] = [
  { type: 'signature', label: 'Signature', Icon: Signature, w: 0.26, h: 0.06 },
  { type: 'initials', label: 'Initials', Icon: Type, w: 0.1, h: 0.05 },
  { type: 'date_signed', label: 'Date signed', Icon: CalendarDays, w: 0.18, h: 0.035 },
  { type: 'name', label: 'Name', Icon: UserRound, w: 0.24, h: 0.035 },
  { type: 'email', label: 'Email', Icon: Mail, w: 0.26, h: 0.035 },
  { type: 'text', label: 'Text', Icon: TextCursorInput, w: 0.24, h: 0.035 },
  { type: 'number', label: 'Number', Icon: Hash, w: 0.14, h: 0.035 },
  { type: 'checkbox', label: 'Checkbox', Icon: SquareCheck, w: 0.03, h: 0.023 },
  { type: 'dropdown', label: 'Dropdown', Icon: ChevronDown, w: 0.22, h: 0.035 },
  { type: 'radio', label: 'Radio group', Icon: CircleDot, w: 0.18, h: 0.06 },
];
const meta = (t: FieldType) => PALETTE.find((p) => p.type === t)!;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Math.random());

export function FieldEditor({
  nav,
  disabled,
  pageCount,
  recipients,
  initial,
}: {
  nav: EditorNav;
  disabled: boolean;
  pageCount: number;
  recipients: Recipient[];
  initial: Field[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Field[]>(initial);
  const [recipientId, setRecipientId] = useState(recipients[0]!.id);
  const [tool, setTool] = useState<FieldType | null>('signature');
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    orig: Field;
    w: number;
    h: number;
  } | null>(null);

  const rIndex = useCallback(
    (id: string) => recipients.find((r) => r.id === id)?.colorIndex ?? 0,
    [recipients],
  );
  const rName = useCallback(
    (id: string) => recipients.find((r) => r.id === id)?.name ?? 'Unknown',
    [recipients],
  );

  const change = useCallback((id: string, patch: Partial<Field>) => {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function place(page: number, px: number, py: number) {
    if (disabled || !tool) return;
    const m = meta(tool);
    const f: Field = {
      id: uid(),
      recipientId,
      type: tool,
      page,
      x: round(clamp(px - m.w / 2, 0, 1 - m.w)),
      y: round(clamp(py - m.h / 2, 0, 1 - m.h)),
      width: m.w,
      height: m.h,
      required: tool !== 'checkbox',
      label: null,
      options: tool === 'dropdown' || tool === 'radio' ? ['Option 1', 'Option 2'] : null,
    };
    setFields((fs) => [...fs, f]);
    setSelected(f.id);
    setDirty(true);
  }

  function onPointerDown(
    e: React.PointerEvent,
    f: Field,
    mode: 'move' | 'resize',
    size: { width: number; height: number },
  ) {
    if (disabled) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(f.id);
    drag.current = {
      id: f.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: f,
      w: size.width,
      h: size.height,
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.w;
    const dy = (e.clientY - d.startY) / d.h;
    if (d.mode === 'move') {
      change(d.id, {
        x: round(clamp(d.orig.x + dx, 0, 1 - d.orig.width)),
        y: round(clamp(d.orig.y + dy, 0, 1 - d.orig.height)),
      });
    } else {
      change(d.id, {
        width: round(clamp(d.orig.width + dx, 0.02, 1 - d.orig.x)),
        height: round(clamp(d.orig.height + dy, 0.015, 1 - d.orig.y)),
      });
    }
  }
  const onPointerUp = () => {
    drag.current = null;
  };

  function onKey(e: React.KeyboardEvent, f: Field) {
    if (disabled) return;
    const step = e.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      change(f.id, {
        x: round(clamp(f.x + m[0], 0, 1 - f.width)),
        y: round(clamp(f.y + m[1], 0, 1 - f.height)),
      });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(f.id);
    } else if (e.key === 'Escape') {
      setSelected(null);
    }
  }

  function remove(id: string) {
    setFields((fs) => fs.filter((f) => f.id !== id));
    setSelected(null);
    setDirty(true);
  }
  function duplicate(f: Field) {
    const copy = { ...f, id: uid(), y: round(clamp(f.y + f.height + 0.01, 0, 1 - f.height)) };
    setFields((fs) => [...fs, copy]);
    setSelected(copy.id);
    setDirty(true);
  }

  function save(next?: string) {
    for (const f of fields) {
      if (
        (f.type === 'dropdown' || f.type === 'radio') &&
        (f.options?.filter((o) => o.trim()).length ?? 0) < 2
      ) {
        setSelected(f.id);
        return setState({
          ok: false,
          message: `Add at least two options to the ${meta(f.type).label.toLowerCase()} field.`,
        });
      }
    }
    start(async () => {
      const res = await nav.onSave(
        fields.map(({ options, label, ...rest }) => ({
          recipientId: rest.recipientId,
          type: rest.type,
          page: rest.page,
          x: rest.x,
          y: rest.y,
          width: rest.width,
          height: rest.height,
          required: rest.required,
          label: label?.trim() || null,
          options: options ? options.map((o) => o.trim()).filter(Boolean) : null,
        })),
      );
      setState(res);
      if (res?.ok) {
        setDirty(false);
        if (next) router.push(next);
        else router.refresh();
      }
    });
  }

  const sel = fields.find((f) => f.id === selected) ?? null;
  const missingSignature = recipients.filter(
    (r) =>
      !fields.some(
        (f) => f.recipientId === r.id && (f.type === 'signature' || f.type === 'initials'),
      ),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:h-fit">
        <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <label className="flex flex-col gap-1 text-sm font-medium text-heading">
            Placing fields for
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              disabled={disabled}
              className="h-10 rounded-lg border border-border bg-white px-2 font-normal"
            >
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <span
            className="mt-2 block h-1.5 rounded-full"
            style={{ background: colorFor(rIndex(recipientId)).border }}
            aria-hidden
          />
          <p className="mt-4 text-sm font-medium text-heading" id="palette-label">
            Field type
          </p>
          <p className="text-xs">Choose a type, then click on the page to place it.</p>
          <div
            role="radiogroup"
            aria-labelledby="palette-label"
            className="mt-2 grid grid-cols-2 gap-2"
          >
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                role="radio"
                aria-checked={tool === p.type}
                disabled={disabled}
                onClick={() => setTool(p.type)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs font-medium',
                  tool === p.type
                    ? 'border-primary bg-primary-surface text-primary'
                    : 'border-border bg-white text-heading hover:bg-blush',
                )}
              >
                <p.Icon className="size-4 shrink-0" aria-hidden />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {sel ? (
          <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
            <p className="font-display text-lg">{meta(sel.type).label}</p>
            <p className="text-xs">
              Page {sel.page}. Use arrow keys to nudge (Shift for larger steps).
            </p>
            <fieldset disabled={disabled} className="mt-3 flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1 font-medium text-heading">
                Assigned to
                <select
                  value={sel.recipientId}
                  onChange={(e) => change(sel.id, { recipientId: e.target.value })}
                  className="h-9 rounded-lg border border-border bg-white px-2 font-normal"
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {sel.type !== 'signature' && sel.type !== 'initials' && sel.type !== 'date_signed' ? (
                <label className="flex flex-col gap-1 font-medium text-heading">
                  Label
                  <input
                    value={sel.label ?? ''}
                    maxLength={120}
                    onChange={(e) => change(sel.id, { label: e.target.value })}
                    className="h-9 rounded-lg border border-border px-2 font-normal"
                  />
                </label>
              ) : null}
              {sel.type === 'dropdown' || sel.type === 'radio' ? (
                <label className="flex flex-col gap-1 font-medium text-heading">
                  Options (one per line)
                  <textarea
                    rows={4}
                    value={(sel.options ?? []).join('\n')}
                    onChange={(e) =>
                      change(sel.id, { options: e.target.value.split('\n').slice(0, 50) })
                    }
                    className="rounded-lg border border-border px-2 py-1 font-normal"
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-heading">
                <input
                  type="checkbox"
                  checked={sel.required}
                  onChange={(e) => change(sel.id, { required: e.target.checked })}
                  className="size-4"
                />
                Required
              </label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => duplicate(sel)}>
                  <Copy className="size-4" aria-hidden /> Duplicate
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => remove(sel.id)}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              </div>
            </fieldset>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-white p-4 text-sm shadow-card">
          <p className="font-medium text-heading">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'} placed
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: colorFor(r.colorIndex).border }}
                  aria-hidden
                />
                <span className="truncate">{r.name}</span>
                <span className="ml-auto text-xs">
                  {fields.filter((f) => f.recipientId === r.id).length}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="min-w-0">
        {missingSignature.length ? (
          <Alert tone="warning" className="mb-4">
            Add a signature field for {missingSignature.map((r) => r.name).join(', ')}.
          </Alert>
        ) : null}
        {pageCount === 0 ? (
          <Alert tone="error">This document has no pages to place fields on.</Alert>
        ) : null}
        <div
          className="rounded-2xl bg-primary-surface/50 p-4 pb-8"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <PdfPages
            src={nav.fileSrc}
            onPageClick={(page, x, y) => place(page, x, y)}
            overlay={(page, size) =>
              fields
                .filter((f) => f.page === page)
                .map((f) => {
                  const c = colorFor(rIndex(f.recipientId));
                  const m = meta(f.type);
                  const active = f.id === selected;
                  return (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${m.label} field for ${rName(f.recipientId)}, page ${page}${f.required ? ', required' : ''}`}
                      aria-pressed={active}
                      onFocus={() => setSelected(f.id)}
                      onKeyDown={(e) => onKey(e, f)}
                      onPointerDown={(e) => onPointerDown(e, f, 'move', size)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'absolute flex select-none items-center gap-1 overflow-hidden rounded px-1 text-[11px] font-semibold touch-none',
                        disabled ? 'cursor-default' : 'cursor-move',
                        active && 'ring-2 ring-offset-1',
                      )}
                      style={{
                        left: f.x * size.width,
                        top: f.y * size.height,
                        width: f.width * size.width,
                        height: f.height * size.height,
                        background: c.bg,
                        border: `1.5px solid ${c.border}`,
                        color: c.text,
                        ['--tw-ring-color' as string]: c.border,
                      }}
                    >
                      <m.Icon className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{f.label || m.label}</span>
                      {f.required ? <span aria-hidden>*</span> : null}
                      {active && !disabled ? (
                        <span
                          onPointerDown={(e) => onPointerDown(e, f, 'resize', size)}
                          className="absolute bottom-0 right-0 size-2.5 cursor-se-resize"
                          style={{ background: c.border }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                  );
                })
            }
          />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <FormStatus state={state} />
          <div className="flex flex-wrap justify-between gap-2">
            <Link href={nav.backHref} className={buttonClass('ghost')}>
              Back
            </Link>
            {disabled ? (
              <Link href={nav.nextHref} className={buttonClass('primary')}>
                {nav.nextLabel}
              </Link>
            ) : (
              <span className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => save()} loading={pending}>
                  Save
                </Button>
                <Button type="button" onClick={() => save(nav.nextHref)} disabled={pending}>
                  Save and continue
                </Button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
