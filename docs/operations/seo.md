# Search visibility (SEO)

What the code does, and the steps only the owner can take.

## What is in place

- **robots.txt** (`apps/web/src/app/robots.ts`): public pages are crawlable. The app, staff pages,
  the API, recipient links (`/sign/`, `/retrieve`, `/invite/`, `/claim/`), My Documents, onboarding,
  account-recovery screens and Signature Studio checkout/receipt/download pages are disallowed. The
  list lives in `PRIVATE_PATHS` in `apps/web/src/lib/seo.ts`.
- **sitemap.xml** (`apps/web/src/app/sitemap.ts`): home, product, pricing, Signature Studio (only
  while it is enabled), sign-up and the legal pages.
- **Canonical URLs, Open Graph and Twitter cards** on every public page through `pageMetadata()` in
  `src/lib/seo.ts`. The canonical origin is `SITE_URL`, then `BETTER_AUTH_URL`, then
  `https://signaturetender.com`.
- **Link-preview images** (1200 × 630, navy and gold) in
  `public/branding/signature-tender/social/og-default.png` and `og-signature-studio.png`.
- **Structured data (JSON-LD)**: Organization and WebSite on every marketing page;
  SoftwareApplication with the live single-request price on home, product and pricing; Product with
  the configured Studio price on `/signature-studio`; FAQPage on product, pricing and Studio. Prices
  are read from the database, never typed in.
- **noindex** on the app, staff, onboarding, invitations, recipient pages and account-recovery
  screens, plus an `X-Robots-Tag: noindex` header on any host other than the canonical one (the
  vercel.app address and preview deployments), set in `src/proxy.ts`.
- **Search engine verification tags** come from environment variables, so no code change is needed:
  `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION`.
- `e2e/seo.spec.ts` checks all of the above.

The API documentation stays signed-in only (`/app/api-docs`), so it is not indexed.

## Owner steps

1. **Google Search Console.** Go to https://search.google.com/search-console, add a **Domain**
   property for `signaturetender.com` and verify it with the TXT record Google gives you, added in
   Hostinger DNS. (Domain verification also covers `www`.) If you prefer the URL-prefix method, copy
   the `content` value of Google's meta tag into the Vercel environment variable
   `GOOGLE_SITE_VERIFICATION` (Production), then redeploy.
2. **Submit the sitemap.** In Search Console, open Sitemaps and submit
   `https://signaturetender.com/sitemap.xml`. Then use URL Inspection on `/`, `/product`, `/pricing`
   and `/signature-studio` and click Request indexing.
3. **Bing Webmaster Tools** (also feeds DuckDuckGo and Yahoo). At https://www.bing.com/webmasters,
   choose Import from Google Search Console, or verify and put the code in
   `BING_SITE_VERIFICATION`. Submit the same sitemap.
4. **Google Business Profile** (optional, if you want to appear for local or brand searches):
   https://business.google.com.
5. **Social profiles.** Set `SOCIAL_LINKEDIN_URL`, `SOCIAL_INSTAGRAM_URL` and `SOCIAL_YOUTUBE_URL`
   in Vercel once the profiles exist. They are added to the Organization data as `sameAs`, which
   helps Google connect the brand.
6. **Publish the legal pages.** Terms, Privacy and the E-Sign Disclosure are placeholders today. Real
   pages build trust with both people and search engines.
7. **Earn links.** List Signature Tender on software directories (for example G2, Capterra, Product
   Hunt, AlternativeTo) and ask partners such as Beam Artist and Jectstack to link to the site.
8. **Watch results.** After a few weeks, check Search Console's Performance and Page indexing
   reports, and turn on Vercel Speed Insights to track Core Web Vitals.

## Notes

- Google shows FAQ rich results only for a small set of authoritative sites. The FAQ data still
  helps search engines and AI answers understand the pages.
- Every page renders per request because of the CSP nonce, so pages are not cached at the edge.
  Response times are still good, but caching the marketing pages would need a different CSP setup.
