import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsNav } from './settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        icon={<Settings className="size-8" />}
        title="Settings"
        description="Manage your workspace, profile, and sign-in security."
      />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
