import { test, expect } from '@playwright/test';

test.describe('Product page', () => {
  test('shows real prices and availability, and every CTA goes somewhere real', async ({ page, request }) => {
    const res = await page.goto('/product');
    expect(res!.status()).toBe(200);
    await expect(page).toHaveTitle('Electronic Signature Features | Signature Tender');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/product$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Signature Tender/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld['@graph'][0].offers.price).toBe('2.99');
    expect(ld['@graph'][1].mainEntity).toHaveLength(15);

    // Header: Product is the current page.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Product' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sign, Send & Manage');

    // Price comes from the price list; visitors start at sign-up that returns to upload.
    const start = page.getByRole('link', { name: /Start Signing — From \$2\.99/ });
    await expect(start).toHaveAttribute('href', '/sign-up?next=%2Fapp%2Fdocuments%2Fnew');
    await expect(page.getByRole('link', { name: 'Send a Document — $2.99' })).toBeVisible();
    await expect(page.getByText('$12.99', { exact: true })).toBeVisible();
    await expect(page.getByText('$9.99/month')).toBeVisible();

    // Integrations are labelled honestly.
    const integrations = page.locator('#integrations');
    await expect(integrations.getByRole('listitem').filter({ hasText: 'Beam Artist' }).getByText('Available')).toBeVisible();
    await expect(integrations.getByRole('listitem').filter({ hasText: 'Salesforce' }).getByText('Coming soon')).toBeVisible();

    // Every internal link on the page resolves.
    const hrefs = await page.$$eval('a[href^="/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')!))]);
    for (const href of hrefs) {
      const path = href.split('#')[0]!;
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), href).toBeLessThan(400);
    }
    // Anchors point at sections that exist.
    const anchors = await page.$$eval('a[href*="#"]', (as) => as.map((a) => a.getAttribute('href')!));
    for (const a of anchors.filter((h) => h.startsWith('#') || h.startsWith('/product#'))) {
      await expect(page.locator(`#${a.split('#')[1]}`), a).toHaveCount(1);
    }
  });

  test('demos work in the browser without saving anything', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => r.method() !== 'GET' && posts.push(r.url()));
    await page.goto('/product');
    await page.getByRole('link', { name: 'Explore Features' }).click();
    await expect(page).toHaveURL(/#features$/);

    // Signature Studio: live preview, style choice and controls.
    const studio = page.locator('#signature-studio');
    await studio.getByLabel('Your name').fill('Casey Demo');
    const preview = studio.getByLabel(/Preview in/);
    await expect(preview).toContainText('Casey Demo');
    await studio.getByRole('radio', { name: /Artistic Signature/ }).check({ force: true });
    await expect(preview).toHaveAttribute('aria-label', 'Preview in Artistic Signature');
    await studio.getByLabel(/Slant/).fill('12');
    await expect(studio.getByText('(12°)')).toBeVisible();
    await studio.getByRole('radio', { name: 'Swash' }).check({ force: true });
    const events = await page.evaluate(() => window.stAnalytics?.map((e) => e.event) ?? []);
    expect(events).toEqual(expect.arrayContaining(['product_page_viewed', 'signature_studio_demo_opened', 'signature_style_selected']));
    // The typed name never reaches analytics.
    expect(JSON.stringify(await page.evaluate(() => window.stAnalytics))).not.toContain('Casey');

    // Preparation demo: place a field for the selected signer.
    const prep = page.locator('#prepare');
    await expect(prep.getByText('2 fields placed.')).toBeVisible();
    await prep.getByRole('radio', { name: 'Initials' }).check({ force: true });
    await prep.getByRole('button', { name: /Place a Initials field for Sam Ortiz/ }).click({ position: { x: 120, y: 160 } });
    await expect(prep.getByText('3 fields placed.')).toBeVisible();
    await prep.getByRole('button', { name: 'Reset' }).click();
    await expect(prep.getByText('2 fields placed.')).toBeVisible();

    // FAQ accordion.
    const q = page.getByRole('button', { name: 'Do recipients need an account?' });
    await expect(q).toHaveAttribute('aria-expanded', 'false');
    await q.click();
    await expect(q).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Recipients sign from a personal link in their email.')).toBeVisible();
    await q.click();
    await expect(q).toHaveAttribute('aria-expanded', 'false');

    expect(posts).toEqual([]);
  });

  test('phone menu opens, lists the pages and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/product');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu.getByRole('link', { name: 'API documentation' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Product' })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});
