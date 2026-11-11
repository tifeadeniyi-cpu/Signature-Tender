'use client';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // Called by the auth client outside React render, so a full navigation is intended here.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/two-factor';
      },
    }),
    passkeyClient(),
  ],
});
