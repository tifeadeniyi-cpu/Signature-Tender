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
    await sql`insert into platform_admins (user_id, note, role)
              select id, 'e2e', 'founder' from "user" where email = ${email}`;
    // A password alone is not enough for staff.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/app\/settings\/security\?staff=1/);
    await expect(page.getByText(/Staff administration needs two-factor sign-in/)).toBeVisible();
    await sql`update "user" set two_factor_enabled = true where email = ${email}`;
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform Command Center' })).toBeVisible();
    await page.getByRole('link', { name: 'Organizations', exact: true }).first().click();
    await page.getByLabel('Name or workspace id').fill('Plain Studio');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Plain Studio').first()).toBeVisible();
    await page.getByRole('link', { name: 'System Health', exact: true }).first().click();
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

test('admin roles limit what staff see; the founder sees the audit trail', async ({ page }) => {
  test.setTimeout(120_000);
  const email = await signUpWithWorkspace(page, 'Founder Person', 'Founder Studio');
  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  const [u] = await sql<{ id: string }[]>`select id from "user" where email = ${email}`;
  const id = u!.id;
  try {
    // A grant without a role is a read-only analyst.
    await sql`insert into platform_admins (user_id, note) values (${id}, 'e2e')`;
    await sql`update "user" set two_factor_enabled = true where id = ${id}`;
    await page.goto('/app');
    await page.locator('summary', { hasText: 'Open account menu' }).click();
    await expect(page.getByRole('link', { name: 'Staff admin' })).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform Command Center' })).toBeVisible();
    // Analysts see platform numbers but not revenue, on the page or in the export.
    await expect(page.getByText('Total Users')).toBeVisible();
    await expect(page.getByText('Total Revenue')).toHaveCount(0);
    const analystCsv = await (await page.request.get('/admin/export?range=last_30_days')).text();
    expect(analystCsv).toContain('Registered users');
    expect(analystCsv).not.toMatch(/revenue/i);
    const nav = page.getByRole('navigation', { name: 'Admin' });
    await expect(nav.getByRole('link', { name: 'Audit Trail' })).toHaveCount(0);
    // Hidden links are not the only protection: the page itself refuses.
    expect((await page.goto('/admin/audit'))?.status()).toBe(404);
    expect((await page.goto('/admin/access'))?.status()).toBe(404);

    await sql`update platform_admins set role = 'founder' where user_id = ${id}`;
    await page.goto('/app');
    await page.locator('summary', { hasText: 'Open account menu' }).click();
    await page.getByRole('link', { name: 'Founder admin' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText('Total Revenue')).toBeVisible();
    await page.getByLabel('Date range').selectOption('this_year');
    await expect(page).toHaveURL(/range=this_year/);
    await expect(
      page.getByRole('heading', { name: 'Document Status (All Organizations)' }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export report' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^command-center-.*\.csv$/);
    const csv = await (await page.request.get('/admin/export?range=this_year')).text();
    expect(csv).toMatch(/revenue/i);
    expect(csv).not.toContain('@');
    const exports = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_events
      where actor_user_id = ${id} and action = 'admin.report_exported'`;
    expect(exports[0]?.n ?? 0).toBeGreaterThanOrEqual(2);
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Audit Trail' })
      .click();
    await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
    // The refused attempt from before is on the record.
    await page.getByLabel('Action, event ID or resource').fill('access_denied');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('cell', { name: 'admin.access_denied' }).first()).toBeVisible();
    await page.getByRole('link', { name: /^View/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Audit event' })).toBeVisible();
    await page.getByRole('link', { name: 'Close event details' }).click();
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Admin Access' })
      .click();
    await expect(page.getByRole('cell', { name: email })).toBeVisible();
  } finally {
    await sql`delete from platform_admins where user_id = ${id}`;
    await sql.end();
  }
});

test('Platform Performance: every tab works for the founder, and roles still limit what shows', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = await signUpWithWorkspace(page, 'Perf Person', 'Perf Studio');
  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  const [u] = await sql<{ id: string }[]>`select id from "user" where email = ${email}`;
  const id = u!.id;
  try {
    await sql`insert into platform_admins (user_id, note, role) values (${id}, 'e2e', 'founder')`;
    await sql`update "user" set two_factor_enabled = true where id = ${id}`;
    await page.goto('/admin');
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Platform Performance' })
      .click();
    await expect(page.getByRole('heading', { name: 'Platform Performance' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Platform Performance sections' });
    await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Key Trends & Insights' })).toBeVisible();
    // Document Status stays a donut.
    await expect(
      page.getByRole('img', { name: 'Status of live requests sent in the period' }),
    ).toBeVisible();

    // Filters carry across tabs through the URL.
    await page.getByLabel('Date range').selectOption('this_year');
    await expect(page).toHaveURL(/range=this_year/);
    for (const [name, heading] of [
      ['Growth', 'User Acquisition'],
      ['Engagement', 'Active Users Over Time'],
      ['Feature Usage', 'Feature Adoption'],
      ['Conversion & Retention', 'Monthly Cohort Retention'],
      ['Delivery & Operations', 'Document Processing Volume'],
    ] as const) {
      await tabs.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page).toHaveURL(/range=this_year/);
    }
    // The founder sees the sanitized failure list.
    await expect(page.getByRole('heading', { name: 'Processing Failures' })).toBeVisible();

    // Exports keep the tab and filters and are logged; no emails in the file.
    const csv = await (
      await page.request.get('/admin/performance/export?tab=delivery&range=this_year')
    ).text();
    expect(csv).toContain('Delivery & Operations');
    expect(csv).not.toContain('@');
    const overview = await (await page.request.get('/admin/performance/export?range=30d')).text();
    expect(overview).toContain('Key trends and insights');
    const logged = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_events
      where actor_user_id = ${id} and action = 'admin.report_exported'`;
    expect(logged[0]?.n ?? 0).toBeGreaterThanOrEqual(2);

    // An analyst can open the tabs but not the failure list or revenue.
    await sql`update platform_admins set role = 'analyst' where user_id = ${id}`;
    await page.goto('/admin/performance?tab=delivery');
    await expect(page.getByRole('heading', { name: 'Document Processing Volume' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Processing Failures' })).toHaveCount(0);
    await page.goto('/admin/performance');
    await expect(page.getByText('Total Revenue')).toHaveCount(0);

    // Support staff have no analytics access at all.
    await sql`update platform_admins set role = 'support' where user_id = ${id}`;
    expect((await page.goto('/admin/performance'))?.status()).toBe(404);
    expect((await page.request.get('/admin/performance/export?tab=growth')).status()).toBe(404);
  } finally {
    await sql`delete from platform_admins where user_id = ${id}`;
    await sql.end();
  }
});
