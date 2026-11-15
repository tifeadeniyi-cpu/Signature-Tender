import Image from 'next/image';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BRAND_ASSETS } from '@/lib/brand-assets';

export type SignStep = 1 | 2 | 3 | 4;
const STEPS = ['Review', 'Sign', 'Complete'] as const;

/**
 * Recipient header: navy bar, reversed logo, the Review → Sign → Complete progress, and an
 * optional actions slot (Help, Save & Exit). `step` 4 means every stage is complete.
 */
export function SignHeader({ step, actions }: { step: SignStep; actions?: React.ReactNode }) {
  return (
    <header
      style={{ backgroundColor: '#0d1b33' }}
      className="relative z-40 flex h-14 shrink-0 items-center gap-3 px-3 text-white sm:h-16 sm:px-5"
    >
      <Image
        {...BRAND_ASSETS.reversed}
        alt="Signature Tender"
        className="h-9 w-auto sm:h-11"
        priority
      />
      <nav aria-label="Signing progress" className="flex flex-1 justify-center">
        <ol className="hidden items-center gap-2 md:flex lg:gap-3">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < step ? 'done' : n === step ? 'active' : 'upcoming';
            return (
              <li key={label} className="flex items-center gap-2 lg:gap-3">
                {i > 0 ? (
                  <span
                    aria-hidden
                    className={cn('h-px w-8 lg:w-16', n <= step ? 'bg-white' : 'bg-white/40')}
                  />
                ) : null}
                <span
                  className="flex items-center gap-2"
                  aria-current={state === 'active' ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                      state === 'upcoming'
                        ? 'border border-white/60 text-white/80'
                        : 'bg-white text-[#0d1b33]',
                    )}
                  >
                    {state === 'done' ? <Check className="size-4" aria-hidden /> : n}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-medium',
                      state === 'upcoming' ? 'text-white/75' : 'text-white',
                    )}
                  >
                    {label}
                    <span className="sr-only">
                      {state === 'done' ? ' (completed)' : state === 'active' ? ' (current)' : ''}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="text-xs font-medium text-white/90 md:hidden">
          {step > 3 ? 'Complete' : `Step ${step} of 3: ${STEPS[step - 1]}`}
        </p>
      </nav>
      {actions ? <div className="flex items-center gap-1 sm:gap-2">{actions}</div> : null}
    </header>
  );
}
