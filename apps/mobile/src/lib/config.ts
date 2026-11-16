import Constants from 'expo-constants';

/**
 * The Signature Tender server the app talks to. Production by default; a development build can
 * point at a local or preview server with EXPO_PUBLIC_API_URL.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'https://signaturetender.com'
).replace(/\/+$/, '');

export const APP_SCHEME = 'signaturetender';
