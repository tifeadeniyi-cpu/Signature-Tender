import type { Metadata } from 'next';
import { getReferralProgram } from '@st/core';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Give 1, Get 2 Referral Program Terms | Signature Tender',
  description: 'How the Signature Tender referral program works.',
};

/** Plain-language program terms. Amounts come from the live program settings. */
export default async function ReferralTermsPage() {
  const p = await getReferralProgram(db());
  const c = (n: number) => `${n} free signing credit${n === 1 ? '' : 's'}`;
  const items: [string, string][] = [
    [
      'Who can refer',
      'Anyone with a verified Signature Tender account and a workspace. Your referral link belongs to you in that workspace, and your rewards are added to that workspace.',
    ],
    [
      'What your friend gets',
      `${c(p.referredCredits)}, added to the first workspace they create after verifying their email. The offer is for new customers only: an existing account cannot claim it.`,
    ],
    [
      'What you get',
      `${c(p.referrerCredits)}, after your friend's first paid document send is confirmed by our payment provider${p.qualificationDelayHours ? ` and a ${p.qualificationDelayHours}-hour settlement period has passed` : ''}. Sign-ups alone do not earn rewards.`,
    ],
    [
      'What a credit covers',
      'One standard document sent for signature from the Signature Tender website, including all its signers, the audit trail and the Certificate of Completion.',
    ],
    [
      'Restrictions',
      'Referral credits have no cash value. They cannot be withdrawn, transferred, refunded, converted to API balances, or used for Signature Studio designs or paid add-ons. Documents sent through the API do not use referral credits.',
    ],
    [
      'One referral per customer',
      'Each new account can be referred once. The first valid referral recorded at sign-up is final.',
    ],
    [
      'Fair use',
      'Self-referrals, duplicate or fake accounts and other abuse are not eligible. Referrals with unusual activity may be held for review. If a qualifying payment is refunded or disputed, the related reward is reversed as far as it is unused.',
    ],
    [
      'Expiry',
      'Referral credits do not expire. If these terms change, credits you have already earned are kept.',
    ],
  ];
  return (
    <section className="bg-ivory">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="font-display text-4xl text-heading">{p.name}: Program Terms</h1>
        <p className="mt-3 text-lg">Share Signature Tender. Earn free signatures.</p>
        <dl className="mt-10 space-y-6">
          {items.map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-border bg-white p-5 shadow-card">
              <dt className="font-semibold text-heading">{t}</dt>
              <dd className="mt-1">{d}</dd>
            </div>
          ))}
        </dl>
        {!p.live ? (
          <p role="status" className="mt-8 text-sm">
            The program is not accepting new referrals right now.
          </p>
        ) : null}
      </div>
    </section>
  );
}
