import { test, expect } from '@playwright/test';

test('marketing pages fit a phone screen without horizontal scroll', async ({ page }) => {
  for (const path of ['/', '/product', '/pricing', '/sign-in', '/sign-up']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
