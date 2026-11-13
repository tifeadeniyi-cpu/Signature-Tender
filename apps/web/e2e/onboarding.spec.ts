import { test, expect } from '@playwright/test';
import { latestLinkFor } from './mail';

const password = 'correct-horse-battery-staple';

test('unauthenticated users are sent to sign in', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('homepage shows configured pricing and no unearned claims', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pay Only When You Need To');
  await expect(page.getByText('$2.99').first()).toBeVisible();
  await expect(page.getByText('Save 13%')).toBeVisible();
  const body = (await page.textContent('body')) ?? '';
  expect(body).not.toMatch(/legally binding|SOC 2|compliant/i);
});

test('sign up, verify, create workspace, edit settings, sign out and back in', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto('/sign-up');
  await page.getByLabel('Full name').fill('Dana Rivers');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Unverified sign-in is refused and routed back to verification.
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/verify-email/);

  const link = await latestLinkFor(email, 'Verify your email');
  await page.goto(link);
  await expect(page).toHaveURL(/onboarding/);
  await page.getByLabel('Workspace name').fill('Rivers Creative');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/app$/);
  // The redesigned dashboard (PR #30) titles the page "Dashboard" instead of greeting by name.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await expect(
    page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Billing & Credits' }),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByText('Your role: Owner')).toBeVisible();
  await page.getByLabel('Website').fill('not a url');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter a full URL, including https://')).toBeVisible();
  await page.getByLabel('Website').fill('https://rivers.example');
  await page.getByLabel('Workspace name').fill('Rivers Creative LLC');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Workspace settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Workspace name')).toHaveValue('Rivers Creative LLC');

  await page.goto('/app/settings/profile');
  await page.getByLabel('Job title').fill('Producer');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  await page.locator('header summary').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/sign-in/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});
