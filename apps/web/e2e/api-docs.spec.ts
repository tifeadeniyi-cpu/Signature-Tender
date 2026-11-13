import { test, expect } from '@playwright/test';
import { signUpWithWorkspace } from './auth';

test('API documentation is not public: signed-out visitors sign in and come back to it', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  // The public site no longer links to it.
  await page.goto('/');
  await expect(page.locator('a[href^="/developers"], a[href^="/app/api-docs"]')).toHaveCount(0);

  // Old links and the new address both send a signed-out visitor to sign-in, with a way back.
  for (const path of ['/developers', '/app/api-docs']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fapi-docs$/);
  }

  // A member signs in from there and lands on the docs, which ask not to be indexed.
  const ctx = await browser.newContext();
  const email = await signUpWithWorkspace(await ctx.newPage(), 'Docs Reader', 'Docs Studio');
  await ctx.close();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/api-docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // It is in the signed-in menu.
  await expect(page.getByRole('link', { name: 'API Docs' }).first()).toBeVisible();
});
