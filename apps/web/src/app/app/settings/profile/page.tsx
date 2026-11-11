import { getProfile } from '@st/core';
import { requireUser } from '@/lib/session';
import { db } from '@/lib/db';
import { Card, CardHeader } from '@/components/ui/card';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile(db(), { userId: user.id });
  return (
    <Card>
      <CardHeader
        title="Profile & Account"
        description="Your name and details as shown to people you send documents to."
      />
      <ProfileForm initial={profile} timezones={Intl.supportedValuesOf('timeZone')} />
    </Card>
  );
}
