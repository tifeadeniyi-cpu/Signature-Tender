import { pageMetadata } from '@/lib/seo';
import { enabledSocialProviders } from '@/lib/social-providers';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = {
  ...pageMetadata({
    title: 'Sign In | Signature Tender',
    description:
      'Sign in to Signature Tender to send documents for electronic signature, track signers and download completed PDFs.',
    path: '/sign-in',
  }),
  robots: { index: true, follow: true },
};

export default function SignInPage() {
  return <SignInForm providers={enabledSocialProviders()} />;
}
