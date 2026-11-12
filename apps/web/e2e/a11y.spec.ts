import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';
import { signUpWithWorkspace } from './auth';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return res.violations.map((v) => ({
    path,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

const PUBLIC = [
  '/',
  '/product',
  '/pricing',
  '/developers',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/retrieve',
  '/sign/not-a-real-token',
];
const APP = [
  '/app',
  '/app/documents',
  '/app/documents/new',
  '/app/templates',
  '/app/templates/new',
  '/app/contacts',
  '/app/team',
  '/app/team?tab=roles',
  '/app/team?tab=groups',
  '/app/billing',
  '/app/integrations',
  '/app/settings',
  '/app/settings/profile',
  '/app/settings/security',
  '/app/settings/branding',
  '/app/settings/retention',
  '/app/settings/developers',
  '/app/reports',
];

test('public and app pages have no WCAG 2.2 AA violations found by axe', async ({ page }) => {
  test.setTimeout(180_000);
  const found = [];
  for (const p of PUBLIC) found.push(...(await scan(page, p)));
  await signUpWithWorkspace(page, 'Axe Tester', 'Axe Studio');
  for (const p of APP) found.push(...(await scan(page, p)));
  if (found.length) console.log(JSON.stringify(found, null, 2));
  expect(found).toEqual([]);
});

test('staff pages have no WCAG 2.2 AA violations found by axe', async ({ page }) => {
  test.setTimeout(120_000);
  const email = await signUpWithWorkspace(page, 'Axe Staff', 'Axe Staff Studio');
  const sql = postgres(
    process.env.TEST_DATABASE_URL_OWNER ??
      'postgres://st_owner:st_owner@localhost:5432/signature_tender_test',
    { max: 1, onnotice: () => {} },
  );
  try {
    await sql`insert into platform_admins (user_id, note) select id, 'axe' from "user" where email = ${email}`;
    const found = [...(await scan(page, '/app/settings/security?staff=1'))];
    await sql`update "user" set two_factor_enabled = true where email = ${email}`;
    for (const p of ['/admin', '/admin/workspaces', '/admin/workspaces?q=Axe', '/admin/operations'])
      found.push(...(await scan(page, p)));
    if (found.length) console.log(JSON.stringify(found, null, 2));
    expect(found).toEqual([]);
  } finally {
    await sql`delete from platform_admins where user_id in (select id from "user" where email = ${email})`;
    await sql.end();
  }
});
