'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Gift, X } from 'lucide-react';

const KEY = 'st.referral-card.dismissed';
const EVENT = 'st-referral-card';
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Dashboard promotion for Refer & Earn. Stays hidden once dismissed in this browser. */
export function ReferralDashboardCard({ give, get }: { give: number; get: number }) {
  // Hidden on the server and until the browser says it was not dismissed: no flash after dismissal.
  const dismissed = useSyncExternalStore(subscribe, read, () => true);
  if (dismissed) return null;
  return (
    <section
      aria-labelledby="referral-card-heading"
      className="relative flex flex-col gap-4 rounded-2xl border border-[#D8AF68]/50 bg-[linear-gradient(135deg,#0D1B33,#172D4D)] p-5 text-white shadow-card sm:flex-row sm:items-center sm:p-6"
    >
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#D8AF68]"
        aria-hidden
      >
        <Gift className="size-6" />
      </span>
      <div className="flex-1 pr-6">
        <h2 id="referral-card-heading" className="font-display text-xl">
          Earn Free Signing Credits
        </h2>
        <p className="mt-1 text-sm text-[#CBD5E1]">
          Give your friends {give} free credit{give === 1 ? '' : 's'}. Earn {get} when they qualify.
        </p>
      </div>
      <Link
        href="/app/referrals"
        className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-b from-soft-gold to-gold px-5 font-semibold text-primary hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Refer &amp; Earn
      </Link>
      <button
        type="button"
        aria-label="Dismiss the Refer & Earn card"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* storage unavailable */
          }
          window.dispatchEvent(new Event(EVENT));
        }}
        className="absolute right-2 top-2 rounded p-1.5 text-[#CBD5E1] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}
