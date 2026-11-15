import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { API_URL, APP_SCHEME } from './config';

/**
 * Sign-in for the app. Better Auth's Expo client keeps the session cookie in the device's
 * secure storage (Keychain / Keystore) and sends it with every request; the server checks it
 * exactly as it does for the website.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({ scheme: APP_SCHEME, storagePrefix: 'signature-tender', storage: SecureStore }),
    twoFactorClient(),
  ],
});
