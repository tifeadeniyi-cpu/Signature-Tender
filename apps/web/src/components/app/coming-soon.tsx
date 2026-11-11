import type { ReactNode } from 'react';
import { Hourglass } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/feedback';

/** Honest placeholder for sections scheduled in a later phase. Shows no sample data. */
export function ComingSoon({
  title,
  description,
  icon,
  phase,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  phase: number;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader icon={icon} title={title} description={description} />
      <EmptyState icon={<Hourglass className="size-5" />} title={`${title} is being built`}>
        <p>{children}</p>
        <p className="mt-2 text-xs text-slate-500">
          Scheduled for Phase {phase} of the build plan.
        </p>
      </EmptyState>
    </>
  );
}
