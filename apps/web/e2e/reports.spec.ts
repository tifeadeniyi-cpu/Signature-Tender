import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { signUpWithWorkspace } from './auth';

const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';

test('dashboard, reports and CSV export work for a new workspace', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Rita Report', 'Report Studio');

  // Dashboard figures are real, so a new workspace shows empty states, never sample data.
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Your documents will appear here.')).toBeVisible();
  await expect(page.getByText('No signing activity for this period.')).toBeVisible();
  await page.getByRole('link', { name: 'Last 7 Days' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByText('No signing activity for this period.')).toBeVisible();

  await page.goto('/app/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  const headline = page.getByRole('region', { name: 'Headline numbers' });
  await expect(headline.getByText('Sent')).toBeVisible();
  await page.getByRole('link', { name: 'Last 90 days' }).click();
  await expect(page).toHaveURL(/from=/);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Export CSV/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
});

test('staff admin is a 404 for customers and opens for staff', async ({ page }) => {
  test.setTimeout(90_000);
  const email = await signUpWithWorkspace(page, 'Not Staff', 'Plain Studio');
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(404);

  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into platform_admins (user_id, note)
              select id, 'e2e' from "user" where email = ${email}`;
    // A password alone is not enough for staff.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/app\/settings\/security\?staff=1/);
    await expect(page.getByText(/Staff administration needs two-factor sign-in/)).toBeVisible();
    await sql`update "user" set two_factor_enabled = true where email = ${email}`;
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await page.getByLabel('Name or workspace id').fill('Plain Studio');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Plain Studio').first()).toBeVisible();
    await page.getByRole('link', { name: 'Operations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_events a join "user" u on u.id = a.actor_user_id
      where u.email = ${email} and a.action = 'admin.viewed'`;
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(3);
  } finally {
    await sql`delete from platform_admins where user_id in (select id from "user" where email = ${email})`;
    await sql.end();
  }
});

test('Slack only accepts a Slack incoming webhook URL', async ({ page }) => {
  await signUpWithWorkspace(page, 'Sal Slack', 'Slack Studio');
  await page.goto('/app/integrations?app=slack');
  await page.getByLabel('Slack incoming webhook URL').fill('https://example.com/not-slack');
  await page.getByRole('button', { name: 'Connect Slack' }).click();
  await expect(page.getByText(/hooks\.slack\.com/).first()).toBeVisible();
});
