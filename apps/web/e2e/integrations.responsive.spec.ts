import { test, expect } from '@playwright/test';
import { signUpWithWorkspace } from './auth';

const SHOTS = process.env.INTEGRATIONS_SHOTS_DIR;

test('integrations marketplace fits a phone without sideways scrolling', async ({ page }) => {
  await signUpWithWorkspace(page, 'Pia Phone', 'Phone Studio');
  for (const path of [
    '/app/integrations',
    '/app/integrations/connected',
    '/app/integrations/activity',
    '/app/integrations/settings',
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await page.goto('/app/integrations');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-mobile-discover.png`, fullPage: true });
  await page.getByRole('button', { name: 'Coming Soon: HubSpot' }).click();
  const drawer = page.getByRole('dialog', { name: 'HubSpot' });
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  const vw = page.viewportSize()!.width;
  // Full screen on phones; a side drawer on wider screens.
  if (vw < 640) expect(box!.width).toBeGreaterThanOrEqual(vw - 1);
  else expect(box!.width).toBeLessThan(vw);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-mobile-drawer.png` });
});
