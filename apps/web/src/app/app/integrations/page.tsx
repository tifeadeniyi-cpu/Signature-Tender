import { Plug } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Integrations' };

export default function Page() {
  return (
    <ComingSoon
      title="Integrations"
      description="Connect Signature Tender to the tools you already use."
      icon={<Plug className="size-8" />}
      phase={7}
    >
      Integrations, including Beam Artist and Jectstack, will be listed here only once they actually
      work.
    </ComingSoon>
  );
}
