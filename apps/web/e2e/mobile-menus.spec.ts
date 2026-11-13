import { test, expect } from '@playwright/test';
import { signUpWithWorkspace } from './auth';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('the app menu opens full screen on a phone and its links work', async ({ page }) => {
  await signUpWithWorkspace(page, 'Pat Phone', 'Phone Works');
  await page.getByRole('button', { name: 'Open navigation' }).tap();
  const menu = page.getByRole('dialog', { name: 'Navigation' });
  await expect(menu).toBeVisible();
  // The panel fills the screen height, not just the 64px top bar.
  const box = await menu.locator('#mobile-nav').boundingBox();
  expect(box!.height).toBeGreaterThan(700);
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await menu.getByRole('link', { name: 'Documents' }).tap();
  await expect(page).toHaveURL(/\/app\/documents/);
  await expect(menu).toBeHidden();
  // Escape closes it too, and focus returns to the menu button.
  await page.getByRole('button', { name: 'Open navigation' }).tap();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
});

test('the website menu opens full screen on a phone, even after scrolling', async ({ page }) => {
  await page.goto('/');
  await page.mouse.wheel(0, 1200);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForFunction(() => window.scrollY > 8);
  await page.getByRole('button', { name: /menu/i }).first().tap();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.height).toBeGreaterThan(700);
  await expect(menu.getByRole('link', { name: 'Sign In' })).toBeInViewport();
  await menu.getByRole('link', { name: 'Sign In' }).tap();
  await expect(page).toHaveURL(/\/sign-in/);
});
