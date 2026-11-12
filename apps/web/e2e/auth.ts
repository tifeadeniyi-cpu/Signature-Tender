import { expect, type Page } from '@playwright/test';
import { latestLinkFor } from './mail';

/** Signs up a fresh verified user with a new workspace and leaves them on the dashboard. */
export async function signUpWithWorkspace(
  page: Page,
  name = 'Sam Okafor',
  workspace = 'Okafor Studio',
) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await latestLinkFor(email, 'Verify your email'));
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}
