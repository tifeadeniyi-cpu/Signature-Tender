# Signature Tender for iOS and Android

The native app, built with Expo (React Native) and Expo Router. It uses the same Signature Tender
server and the same account as the website: nothing is stored on the phone except the session,
which lives in the device's secure storage (Keychain on iPhone, Keystore on Android).

This folder is **not** part of the pnpm workspace. It has its own `package-lock.json`, so React
Native never touches the website's build. Use `npm` here.

## What it does (phase 1)

- **Sign in** with email and password, including two-step codes and backup codes. Create an account.
- **Home:** counts by status and the documents waiting on signers.
- **Documents:** the website's Kanban board, one status at a time, with search, sort, date range,
  pull to refresh and endless scrolling. Status always comes from the signing workflow.
- **Document details:** signing progress, every recipient's status, activity, the certificate ID.
  **Send reminder** and **Cancel request** appear only when the server allows them.
  Completed agreements: download and share the complete package, the signed agreement only, or the
  Certificate of Completion.
- **Sign:** recipients open the signing link from their email (it opens the app once universal
  links are set up) or paste it. Signing uses the website's signing page inside the app, so consent,
  evidence and the certificate are exactly the same.
- **Account:** switch workspace, website settings, sign out.
- Preparing and sending a new document opens the website in an in-app browser for now.

## Run it

```bash
npm install
npx expo run:ios        # or: npx expo run:android (needs Xcode / Android Studio)
```

Native modules (secure storage, web view) are not in Expo Go, so use a development build:
`npx eas-cli@latest build --profile development --platform ios`.

Point a development build at another server with `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000`.

## Checks

```bash
npm run check:shared   # the copied website types still match
npx tsc --noEmit
npx eslint src
npx jest
```

CI runs all four (the `mobile` job in `.github/workflows/ci.yml`).

## Shipping to the App Store and Google Play

You need an Apple Developer Program membership and a Google Play developer account, both in the
business's name, and a free Expo account.

1. `npx eas-cli@latest login`, then `npx eas-cli@latest init` (links the project; adds the EAS project ID).
2. `npx eas-cli@latest build --profile production --platform all` (EAS manages signing certificates).
3. Universal links, so email signing links open the app:
   - iOS: set `APPLE_TEAM_ID` on the website (already used for Sign in with Apple).
   - Android: set `ANDROID_APP_CERT_SHA256` on the website to the fingerprint shown by
     `npx eas-cli@latest credentials`.
   The website then serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`.
4. `npx eas-cli@latest submit --platform ios` / `--platform android`, then complete the store listings
   (screenshots, privacy details, the review account).

## Code map

- `src/app/` routes only: `(auth)` sign-in and sign-up, `(app)/(tabs)` Home, Documents, Sign,
  Account, `(app)/document/[id]`, `sign/[token]`.
- `src/lib/` the API client, sign-in client, session, theme and helpers.
- `src/lib/shared/` response types copied from `apps/web/src/lib` (checked in CI).
- Server endpoints for the app live in `apps/web/src/app/api/mobile`; it also uses the website's
  `/api/documents/board` and `/api/documents/[id]/summary`.
