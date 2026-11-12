import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUpWithWorkspace } from './auth';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ORDER = [
  'Dashboard',
  'Documents',
  'Templates',
  'Contacts',
  'Team',
  'Billing & Credits',
  'Integrations',
  'Settings',
];

test('desktop sidebar: links, active states, submenus, collapse, tooltips, flyouts and preference', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpWithWorkspace(page, 'Sid Sidebar', 'Sidebar Studio');
  await page.goto('/app');
  const side = page.getByRole('complementary', { name: 'Sidebar' });
  const nav = side.getByRole('navigation', { name: 'Primary' });

  // Logo, order, no duplicates, dashboard active.
  await expect(side.getByRole('link', { name: 'Signature Tender dashboard' })).toBeVisible();
  const tops = nav.locator(':scope > ul > li > div > a, :scope > ul > li > a');
  await expect(tops).toHaveText(ORDER);
  await expect(side.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // The open sidebar passes the accessibility scan.
  const axe = await new AxeBuilder({ page }).include('aside').withTags(TAGS).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

  // Every top-level link goes somewhere real.
  for (const label of ORDER) {
    await side.getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(page.url()).not.toMatch(/sign-in|404/);
  }

  // Parent label navigates; the chevron only toggles.
  await page.goto('/app');
  const toggle = side.getByRole('button', { name: 'Show Documents pages' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(side.getByRole('button', { name: 'Hide Documents pages' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page).toHaveURL(/\/app$/);
  await side.getByRole('link', { name: 'Completed' }).click();
  await expect(page).toHaveURL(/\/app\/documents\?tab=completed$/);
  await expect(side.getByRole('link', { name: 'Completed' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await side.getByRole('button', { name: 'Hide Documents pages' }).click();
  await expect(side.getByRole('link', { name: 'Completed' })).toBeHidden();

  // A direct visit to a nested route opens its group and marks the child.
  await page.goto('/app/settings/profile');
  await expect(side.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/app/billing?tab=plans');
  await expect(side.getByRole('link', { name: 'Plans & Pricing' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Get Started opens the existing upload step; nothing is charged for a draft.
  await expect(side.getByRole('region', { name: 'Get started' })).toBeVisible();
  await side.getByRole('link', { name: 'Create Document' }).click();
  await expect(page).toHaveURL(/\/app\/documents\/new$/);
  await expect(page.getByLabel('PDF file')).toBeVisible();

  // Collapse: narrow rail, content moves over without overlap, labels become tooltips.
  const main = page.locator('main');
  const before = (await main.boundingBox())!;
  await side.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThanOrEqual(84);
  const rail = (await side.boundingBox())!;
  await expect.poll(async () => (await main.boundingBox())!.x).toBeLessThan(before.x);
  expect((await main.boundingBox())!.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
  const templates = side.getByRole('link', { name: 'Templates', exact: true });
  await templates.hover();
  await expect(page.getByText('Templates', { exact: true }).last()).toBeVisible();
  await expect(side.getByRole('link', { name: 'Create Document' })).toBeVisible();

  // Collapsed groups open a flyout rather than a clipped submenu.
  await side.getByRole('button', { name: 'Billing & Credits' }).click();
  const fly = page.getByRole('menu', { name: 'Billing & Credits' });
  await expect(fly).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fly).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Billing & Credits' })).toBeFocused();
  await side.getByRole('button', { name: 'Documents' }).click();
  await page.getByRole('menuitem', { name: 'Archived' }).click();
  await expect(page).toHaveURL(/\/app\/documents\?tab=archived$/);

  // The preference survives a reload, then expands again from the keyboard.
  await page.reload();
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  await side.getByRole('button', { name: 'Expand sidebar' }).focus();
  await page.keyboard.press('Enter');
  await expect(side).toHaveAttribute('data-collapsed', 'false');
  await expect(side.getByRole('button', { name: 'Collapse sidebar' })).toBeFocused();
});

test('short screens scroll the menu and keep every item reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await signUpWithWorkspace(page, 'Sho Short', 'Short Studio');
  await page.goto('/app/settings');
  const side = page.getByRole('complementary', { name: 'Sidebar' });
  const cta = side.getByRole('link', { name: 'Create Document' });
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeInViewport();
  await cta.click();
  await expect(page).toHaveURL(/\/app\/documents\/new$/);
});

test('phone drawer opens, navigates, closes and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpWithWorkspace(page, 'Mo Drawer', 'Drawer Studio');
  await page.goto('/app');
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden();
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await drawer.getByRole('button', { name: 'Show Settings pages' }).click();
  await drawer.getByRole('link', { name: 'Security' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/security$/);
  await expect(drawer).toHaveCount(0);

  await trigger.click();
  await page.mouse.click(380, 400);
  await expect(drawer).toHaveCount(0);
});
