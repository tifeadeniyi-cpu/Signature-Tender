import { enabledSocialProviders } from '@/lib/social-providers';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return <SignInForm providers={enabledSocialProviders()} />;
}
