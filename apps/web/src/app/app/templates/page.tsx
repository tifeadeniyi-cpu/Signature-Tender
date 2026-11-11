import { Layers } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Templates' };

export default function Page() {
  return (
    <ComingSoon
      title="Templates"
      description="Create, manage, and reuse document templates for faster, consistent signing."
      icon={<Layers className="size-8" />}
      phase={6}
    >
      Reusable templates with saved signers and fields will live here.
    </ComingSoon>
  );
}
