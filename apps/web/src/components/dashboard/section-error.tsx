'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw, TriangleAlert } from 'lucide-react';

/**
 * Shown in place of one dashboard section when its data could not be loaded. Never shows zeros
 * that could be mistaken for real figures; the rest of the dashboard keeps working.
 */
export function SectionError({ what }: { what: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-error/20 bg-error-bg/50 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-error">
        <TriangleAlert className="size-4" aria-hidden /> We couldn&apos;t load {what}.
      </p>
      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 font-semibold text-primary hover:bg-cream disabled:opacity-60"
      >
        <RotateCw
          className={`size-4 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`}
          aria-hidden
        />
        Retry
      </button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-cream motion-reduce:animate-none ${className ?? ''}`}
    />
  );
}
