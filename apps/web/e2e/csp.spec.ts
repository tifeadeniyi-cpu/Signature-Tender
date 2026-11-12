import { test, expect } from '@playwright/test';

test('pages send a nonce CSP without unsafe-inline scripts, and nothing is blocked', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()))
      violations.push(m.text());
  });
  const res = await page.goto('/sign-in');
  const csp = res!.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  // Next.js put the nonce on its scripts, and the page hydrated (React attached to the root).
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  expect(await page.locator(`script[nonce]`).count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => [...document.scripts].every((s) => s.src || s.nonce))).toBe(
    true,
  );
  expect(nonce).toBeTruthy();
  const second = await page.request.get('/sign-in');
  expect(second.headers()['content-security-policy']).not.toBe(csp);
  expect(violations).toEqual([]);

  const api = await page.request.get('/api/contacts/export');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");
});
