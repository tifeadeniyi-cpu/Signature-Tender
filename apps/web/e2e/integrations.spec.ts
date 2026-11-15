import { test, expect } from '@playwright/test';
import { signUpWithWorkspace } from './auth';

const SHOTS = process.env.INTEGRATIONS_SHOTS_DIR;

test('marketplace: search, categories, details and honest availability', async ({ page }) => {
  await signUpWithWorkspace(page, 'Mara Market', 'Market Studio');
  await page.goto('/app/integrations');
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
  await expect(
    page.getByText('Connect your favorite apps and automate document signing.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore API' })).toHaveAttribute(
    'href',
    '/app/settings/developers',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-discover.png`, fullPage: true });

  // Search by name, category and capability.
  const search = page.getByRole('searchbox', { name: 'Search apps and integrations' });
  await search.fill('hubspot');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'HubSpot' })).toBeVisible();
  await search.fill('save certificates');
  await expect(page.getByRole('heading', { name: 'Google Drive' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HubSpot' })).toHaveCount(0);
  await search.fill('');

  // Categories.
  await page.getByRole('button', { name: 'CRM & Sales' }).click();
  await expect(page.getByRole('button', { name: 'CRM & Sales' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Salesforce' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Google Drive' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connected' }).click();
  await expect(page.getByText('No integrations match')).toBeVisible();
  await page.getByRole('button', { name: 'All Integrations' }).click();

  // Unbuilt apps are Coming Soon and cannot connect.
  for (const name of ['Google Drive', 'HubSpot', 'Zapier', 'Make', 'Salesforce']) {
    const card = page.getByRole('article', { name });
    await expect(card.getByText('Coming Soon').first()).toBeVisible();
    await expect(card.getByRole('button', { name: `Coming Soon: ${name}` })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Coming Soon: Google Drive' }).click();
  const drawer = page.getByRole('dialog', { name: 'Google Drive' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Planned features')).toBeVisible();
  await expect(drawer.getByText('Access and data sharing')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Coming Soon' })).toBeDisabled();
  await expect(page).toHaveURL(/app=google_drive/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-details-drawer.png` });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Coming Soon: Google Drive' })).toBeFocused();

  // The OAuth start route refuses an unbuilt connector.
  await page.goto('/api/integrations/oauth/google_drive/start');
  await expect(page).toHaveURL(/error=unavailable/);
  await expect(page.getByText('This app cannot be connected right now.')).toBeVisible();

  // A forged callback is rejected before anything else happens.
  await page.goto('/api/integrations/oauth/google_drive/callback?state=forged&code=x');
  await expect(page).toHaveURL(/error=unavailable|error=state/);
});

test('connected apps, automations, logs and settings pages', async ({ page }) => {
  await signUpWithWorkspace(page, 'Cole Connect', 'Connect Studio');
  await page.goto('/app/integrations/connected');
  await expect(page.getByText('No connected apps yet')).toBeVisible();
  await page.getByRole('link', { name: 'Automations' }).click();
  await expect(page.getByText('No automations yet')).toBeVisible();
  await page.getByRole('link', { name: 'Activity & Sync Logs' }).click();
  await expect(page.getByText('No activity yet')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Integrations' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Who can do what' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-settings.png`, fullPage: true });

  // A link to a working app opens its drawer with the real connect form.
  await page.goto('/app/integrations?app=slack');
  const slack = page.getByRole('dialog', { name: 'Slack' });
  await expect(slack.getByLabel('Slack incoming webhook URL')).toBeVisible();
  await expect(slack.getByRole('button', { name: 'Connect Slack' })).toBeVisible();
});
