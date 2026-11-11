import { fileURLToPath as __toPath } from 'node:url';
const __dirname = __toPath(new URL('.', import.meta.url));
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const MAIL_DIR = path.resolve(__dirname, '.mail-e2e');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://st_app:st_app@localhost:5432/signature_tender_test',
      BETTER_AUTH_SECRET: 'e2e-only-secret-0123456789abcdef0123456789',
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      APP_ENV: 'test',
      DEV_MAIL_DIR: MAIL_DIR,
    },
  },
});
