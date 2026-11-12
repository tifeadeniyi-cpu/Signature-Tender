import Image from 'next/image';
import { redirect } from 'next/navigation';
import { listMyWorkspaces } from '@st/core';
import { requireUser } from '@/lib/session';
import { db } from '@/lib/db';
import { OnboardingForm } from './onboarding-form';
import { BRAND_ASSETS } from '@/lib/brand-assets';

export const metadata = { title: 'Create your workspace' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser();
  const { new: isNew } = await searchParams;
  const existing = await listMyWorkspaces(db(), { userId: user.id });
  if (existing.length > 0 && !isNew) redirect('/app');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-ivory to-blush px-4 py-10">
      <Image
        {...BRAND_ASSETS.horizontalLight}
        alt="Signature Tender"
        className="mb-6 h-auto w-48"
        priority
      />
      <main
        id="main"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8"
      >
        <h1 className="font-display text-2xl">
          {existing.length ? 'Create another workspace' : `Welcome, ${user.name.split(' ')[0]}`}
        </h1>
        <p className="mt-1 text-sm">
          A workspace holds your documents, templates and team. You can rename it later.
        </p>
        <OnboardingForm
          suggested={existing.length ? '' : `${user.name.split(' ')[0]}'s Workspace`}
        />
      </main>
    </div>
  );
}
