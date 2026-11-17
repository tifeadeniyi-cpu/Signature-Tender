import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

/**
 * Give 1, Get 2, end to end: copy a link, a new person signs up through it, verifies, gets 1
 * credit, makes their first paid send (local Stripe stand-in), and the referrer gets 2.
 */
const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
const FLAGS = ['payments', 'production_signing'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeAll(async () => {
  await sql`update feature_flags set enabled = true where key in ${sql(FLAGS)}`;
  await sql`update referral_programs set status = 'active', qualification_delay_hours = 0,
    referrer_credits = 2, referred_credits = 1, settings = '{}'::jsonb where key = 'standard'`;
});
test.afterAll(async () => {
  await sql`update feature_flags set enabled = false where key in ${sql(FLAGS)}`;
  await sql`update referral_programs set status = 'paused' where key = 'standard'`;
  await sql.end();
});

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

/** The friend's first paid send: Sign it yourself for $0.99 through the Stripe stand-in. */
async function paidSelfSign(page: Page) {
  await page.goto('/app/documents/new?self=1');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Lease.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Lease'),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Pay and sign now' }).click();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page).toHaveURL(/\/sign\/[A-Za-z0-9_-]{43}$/, { timeout: 30_000 });
}

test('Give 1, Get 2: a friend joins through the link, gets 1 credit, pays, and the referrer gets 2', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const referrerCtx = await browser.newContext();
  const referrer = await referrerCtx.newPage();
  const referrerEmail = await signUpWithWorkspace(referrer, 'Rita Referrer', 'Rita Co');

  // The menu shows Refer & Earn while the program runs.
  await referrer
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('link', { name: 'Refer & Earn', exact: true })
    .click();
  await expect(referrer.getByRole('heading', { name: 'Refer & Earn', level: 1 })).toBeVisible();
  await expect(referrer.getByRole('heading', { name: 'Give 1. Get 2.' })).toBeVisible();
  const url = await referrer.getByLabel('Your referral link').inputValue();
  expect(url).toMatch(/\/r\/[A-HJ-NP-Z2-9]{8}$/);
  const code = url.split('/r/')[1]!;
  await referrer.getByRole('button', { name: 'Copy Referral Link' }).click();
  await expect(referrer.getByText('Referral link copied.')).toBeVisible();

  // Share dialog: real share links with the link encoded, keyboard-closable.
  await referrer.getByRole('button', { name: 'Share Referral' }).click();
  const dialog = referrer.getByRole('dialog', { name: 'Share Signature Tender' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    new RegExp(
      `^https://wa\\.me/\\?text=.*${encodeURIComponent(url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ),
  );
  await expect(dialog.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
    'href',
    /linkedin\.com/,
  );
  await referrer.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(referrer.getByRole('button', { name: 'Share Referral' })).toBeFocused();

  // Accessibility of the page.
  const axe = await new AxeBuilder({ page: referrer }).include('main').withTags(TAGS).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

  // A new person opens the link.
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  await friend.goto(new URL(url).pathname);
  await expect(friend).toHaveURL(/\/invited$/);
  await expect(friend.getByRole('heading', { name: /Invited to Signature Tender/ })).toBeVisible();
  await expect(friend.getByText('You Get 1 Free Signing Credit')).toBeVisible();
  await friend.getByRole('link', { name: 'Create Free Account' }).click();
  await expect(friend.getByLabel('Referral Code (Optional)')).toHaveValue(code);
  const friendEmail = `e2e-ref-${Date.now()}@example.test`;
  await friend.getByLabel('Full name').fill('Femi Friend');
  await friend.getByLabel('Email').fill(friendEmail);
  await friend.getByLabel('Password').fill('correct-horse-battery-staple');
  await friend.getByRole('button', { name: 'Create account' }).click();
  await expect(friend.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await latestMail(referrerEmail, 'Someone joined Signature Tender');

  // Verifying and creating a workspace pays exactly 1 credit there.
  await friend.goto(await latestLinkFor(friendEmail, 'Verify your email'));
  await friend.getByLabel('Workspace name').fill('Femi Ventures');
  await friend.getByRole('button', { name: 'Create workspace' }).click();
  await expect(friend).toHaveURL(/\/app\?referral=welcome$/);
  await expect(
    friend.getByRole('heading', { name: 'Your Free Signing Credit Is Ready!' }),
  ).toBeVisible();
  await latestMail(friendEmail, 'Your Free Signature Tender Credit Is Ready');
  await friend.goto('/app/billing?tab=credits');
  const referralCard = friend.locator('section', {
    has: friend.getByRole('heading', { name: 'Referral Credits' }),
  });
  await expect(referralCard.getByRole('definition').first()).toHaveText('1');

  // Signing up alone does not reward the referrer.
  await referrer.reload();
  await expect(referrer.getByRole('row', { name: /Femi F\./ })).toContainText(
    'Awaiting First Purchase',
  );
  await expect(referrer.getByRole('row', { name: /Femi F\./ })).toContainText('2 Credits Pending');
  await expect(referrer.getByText('femi', { exact: false }).filter({ hasText: '@' })).toHaveCount(
    0,
  );

  // The friend's first paid send qualifies the referral.
  await paidSelfSign(friend);
  await latestMail(referrerEmail, "You've Earned 2 Free Signing Credits", 20_000);
  await referrer.reload();
  const row = referrer.getByRole('row', { name: /Femi F\./ });
  await expect(row).toContainText('Rewarded');
  await expect(row).toContainText('+2 Credits');
  await referrer.getByRole('link', { name: /Available Referral Credits/ }).click();
  await expect(referrer).toHaveURL(/\/app\/billing$/);
  await expect(referrer.getByText(/2 referral/)).toBeVisible();

  await referrerCtx.close();
  await friendCtx.close();
});

test('bad and own codes are refused with a clear message', async ({ page }) => {
  await page.goto('/r/ZZZZZZZZ');
  await expect(page).toHaveURL(/\/invited\?status=invalid$/);
  await expect(page.getByText('That referral code is not valid.')).toBeVisible();

  await page.goto('/sign-up');
  await page.getByLabel('Full name').fill('Bad Code');
  await page.getByLabel('Email').fill(`e2e-bad-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByLabel('Referral Code (Optional)').fill('ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('That referral code is not valid. Check it and try again.')).toBeVisible();
  // Clearing the code lets them sign up normally.
  await page.getByLabel('Referral Code (Optional)').fill('');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
});

test('Refer & Earn works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpWithWorkspace(page, 'Mo Mobile', 'Mobile Co');
  await page.goto('/app/referrals');
  await expect(page.getByRole('button', { name: 'Copy Referral Link' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Share Referral' }).click();
  await expect(page.getByRole('dialog', { name: 'Share Signature Tender' })).toBeVisible();
});
