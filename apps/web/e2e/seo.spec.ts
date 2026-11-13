import { test, expect, type Page } from '@playwright/test';

/** Search and link-preview basics for the public site, and keeping private pages out. */

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b));
}

const graphTypes = (blocks: { '@graph'?: { '@type': string }[]; '@type'?: string }[]) =>
  blocks.flatMap((b) => (b['@graph'] ? b['@graph'].map((n) => n['@type']) : [b['@type']]));

const PUBLIC_PAGES = [
  {
    path: '/',
    title: /Electronic Signatures Without a Subscription/,
    types: ['SoftwareApplication'],
  },
  { path: '/pricing', title: /E-Signature Pricing/, types: ['SoftwareApplication', 'FAQPage'] },
  { path: '/product', title: /E-Signature Features/, types: ['SoftwareApplication', 'FAQPage'] },
  {
    path: '/signature-studio',
    title: /Handwritten Signature Online/,
    types: ['Product', 'FAQPage'],
  },
];

test.describe('SEO', () => {
  for (const p of PUBLIC_PAGES) {
    test(`${p.path} has a title, description, canonical, previews and structured data`, async ({
      page,
    }) => {
      const res = await page.goto(p.path);
      expect(res!.status()).toBe(200);
      await expect(page).toHaveTitle(p.title);
      expect(await page.title()).not.toMatch(/\| Signature Tender \| Signature Tender/);
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description!.length).toBeGreaterThan(70);
      expect(description!.length).toBeLessThanOrEqual(170);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(new URL(canonical!).pathname).toBe(p.path);
      await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
        'content',
        /\/branding\/signature-tender\/social\/og-.+\.png$/,
      );
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const types = graphTypes(await jsonLd(page));
      expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', ...p.types]));
    });
  }

  test('Studio structured data carries the configured price', async ({ page }) => {
    await page.goto('/signature-studio');
    const product = (await jsonLd(page))
      .flatMap((b) => b['@graph'] ?? [b])
      .find((n: { '@type': string }) => n['@type'] === 'Product');
    expect(product.offers.price).toBe('0.99');
    expect(product.offers.priceCurrency).toBe('USD');
  });

  test('preview images are served', async ({ request }) => {
    for (const f of ['og-default.png', 'og-signature-studio.png']) {
      const res = await request.get(`/branding/signature-tender/social/${f}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
    }
  });

  test('robots.txt keeps the app, staff and recipient links out and points to the sitemap', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    for (const path of ['/app', '/admin', '/api/', '/sign/', '/retrieve', '/invite/', '/claim/']) {
      expect(body).toContain(`Disallow: ${path}\n`);
    }
    expect(body).not.toMatch(/Disallow: \/\n/);
    expect(body).toMatch(/Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
  });

  test('sitemap lists the public pages only', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(urls).toEqual(
      expect.arrayContaining(['/', '/product', '/pricing', '/signature-studio', '/sign-up']),
    );
    for (const u of urls) expect(u).not.toMatch(/^\/(app|admin|api|sign\/|retrieve|invite|claim)/);
  });

  test('private and token pages tell search engines not to index them', async ({
    page,
    request,
  }) => {
    for (const path of ['/forgot-password', '/retrieve']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
    const sign = await request.get('/sign/not-a-real-token', { maxRedirects: 0 });
    expect(sign.headers()['x-robots-tag']).toContain('noindex');
    await page.goto('/sign-in');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
  });

  test('the web app manifest is served', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    expect((await res.json()).theme_color).toBe('#0D1B33');
  });
});
