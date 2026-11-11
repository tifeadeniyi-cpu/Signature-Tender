import { notFound } from 'next/navigation';

const DOCS: Record<string, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  'esign-disclosure': 'Electronic Signature Disclosure and Consent',
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const title = DOCS[doc];
  if (!title) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-4xl">{title}</h1>
      <div
        className="mt-6 rounded-xl border border-warning/30 bg-warning-bg p-4 text-sm text-warning"
        role="status"
      >
        This document is being prepared with legal counsel and will be published before Signature
        Tender accepts real customer documents.
      </div>
    </div>
  );
}
