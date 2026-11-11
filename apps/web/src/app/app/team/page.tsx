import { Users } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Team' };

export default function Page() {
  return (
    <ComingSoon
      title="Team"
      description="Manage your team, roles, access, and signing permissions."
      icon={<Users className="size-8" />}
      phase={6}
    >
      Inviting teammates and assigning roles arrives with team management. Roles and permissions are
      already enforced behind the scenes.
    </ComingSoon>
  );
}
