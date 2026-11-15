import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { signUpWithWorkspace } from './auth';

/** With payments live, a company saves a card (Stripe setup checkout) before adding people. */
const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
const FLAGS = ['payments', 'production_signing'];
test.beforeAll(async () => {
  await sql`update feature_flags set enabled = true where key in ${sql(FLAGS)}`;
});
test.afterAll(async () => {
  await sql`update feature_flags set enabled = false where key in ${sql(FLAGS)}`;
  await sql.end();
});

test('a company adds a card on file before it can invite team members', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Cara Card', 'Card Company');
  await page.goto('/app/team');
  await expect(page.getByRole('heading', { name: 'Add a card to invite your team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite Member' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a card' }).click();
  await expect(page.getByText('Save a card')).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page).toHaveURL(/\/app\/team\?card=saved/);
  await expect(page.getByText('Card saved. You can now invite team members.')).toBeVisible();

  await page.getByRole('button', { name: 'Invite Member' }).click();
  const form = page.getByRole('form', { name: 'Invite a member' });
  await form.getByLabel('Email').fill(`card-hire-${Date.now()}@example.test`);
  await form.getByLabel('Role').selectOption({ label: 'Viewer' });
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(/Invitation sent to/)).toBeVisible();

  await page.goto('/app/billing');
  await expect(page.getByText('Visa ending 4242')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace card' })).toBeVisible();
});
