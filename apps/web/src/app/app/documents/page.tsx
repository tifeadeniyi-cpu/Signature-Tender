import { FileText } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Documents' };

export default function Page() {
  return (
    <ComingSoon
      title="Documents"
      description="Create, send, and manage your documents for signature."
      icon={<FileText className="size-8" />}
      phase={2}
    >
      Uploading documents, adding signers and placing fields arrives next. Your documents will be
      listed here once you create them.
    </ComingSoon>
  );
}
