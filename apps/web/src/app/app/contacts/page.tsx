import { Contact } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Contacts' };

export default function Page() {
  return (
    <ComingSoon
      title="Contacts"
      description="Save the people you send documents to."
      icon={<Contact className="size-8" />}
      phase={6}
    >
      Saved contacts and signing history will appear here.
    </ComingSoon>
  );
}
