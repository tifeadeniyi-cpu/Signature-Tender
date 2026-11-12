import { requireUser } from '@/lib/session';
import { Alert } from '@/components/ui/feedback';
import { SecurityPanels } from './security-panels';

export const metadata = { title: 'Security' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const user = await requireUser();
  const { staff } = await searchParams;
  return (
    <>
      {staff ? (
        <div className="mb-4">
          <Alert tone="warning">
            Staff administration needs two-factor sign-in or a passkey on your account. Turn one on
            below, then open the staff area again.
          </Alert>
        </div>
      ) : null}
      <SecurityPanels twoFactorEnabled={Boolean(user.twoFactorEnabled)} />
    </>
  );
}
