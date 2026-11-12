import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const STEPS = [
  { key: 'document', label: 'Document' },
  { key: 'signers', label: 'Signers' },
  { key: 'fields', label: 'Fields' },
  { key: 'settings', label: 'Settings' },
  { key: 'review', label: 'Review & send' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

export function Stepper({ current, documentId }: { current: StepKey; documentId?: string }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Preparation steps" className="mb-6 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          const inner = (
            <>
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-bold',
                  active
                    ? 'bg-primary text-white'
                    : done
                      ? 'bg-primary-surface text-primary'
                      : 'border border-border bg-white text-slate-500',
                )}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cn('text-sm', active ? 'font-semibold text-heading' : '')}>
                {s.label}
              </span>
            </>
          );
          return (
            <li key={s.key} className="flex items-center gap-2">
              {documentId ? (
                <Link
                  href={`/app/documents/${documentId}/prepare/${s.key}`}
                  aria-current={active ? 'step' : undefined}
                  className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-blush"
                >
                  {inner}
                </Link>
              ) : (
                <span
                  aria-current={active ? 'step' : undefined}
                  className="flex items-center gap-2 px-1 py-1"
                >
                  {inner}
                </span>
              )}
              {i < STEPS.length - 1 ? (
                <span className="h-px w-6 bg-border sm:w-10" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
