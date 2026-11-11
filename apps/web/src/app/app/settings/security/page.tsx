import { requireUser } from '@/lib/session';
import { SecurityPanels } from './security-panels';

export const metadata = { title: 'Security' };

export default async function SecurityPage() {
  const user = await requireUser();
  return <SecurityPanels twoFactorEnabled={Boolean(user.twoFactorEnabled)} />;
}
