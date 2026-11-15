import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

async function upload(page: Page, filename: string) {
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: await makePdf(filename),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  return page.url().split('/documents/')[1]!.split('/')[0]!;
}

/** Uploads a PDF, adds one signer with one signature field, and sends a free test request. */
async function sendTestRequest(page: Page, filename: string, signerName: string, email: string) {
  const id = await upload(page, filename);
  await page.getByLabel('Full name').first().fill(signerName);
  await page.getByLabel('Email', { exact: true }).first().fill(email);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  return id;
}

async function sign(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.getByLabel('I agree to use electronic records').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Sign here/ }).click();
  await page.getByRole('button', { name: 'Use This Signature' }).click();
  await page
    .getByRole('navigation', { name: 'Field navigation' })
    .getByRole('button', { name: 'Finish Signing' })
    .click();
  await page.getByLabel(/intend to sign it electronically/).check();
  await page.getByRole('button', { name: 'Complete Signing' }).click();
  await expect(page.getByRole('heading', { name: "You've Completed Your Signing" })).toBeVisible({
    timeout: 20_000,
  });
}

const col = (page: Page, label: string) =>
  page.getByRole('region', { name: 'Documents board' }).locator('section', {
    has: page.getByRole('heading', { name: new RegExp(`^${label}`) }),
  });

test('the Kanban board groups by real status, refuses status drags, and stays in sync', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signUpWithWorkspace(page, 'Kay Board', 'Board Works');
  const email = `board-${Date.now()}@example.test`;
  const draftId = await upload(page, 'Vendor Contract.pdf');
  const sentId = await sendTestRequest(page, 'Consulting Proposal.pdf', 'Jo Dale', email);

  await page.goto('/app/documents');
  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page).toHaveURL(/view=kanban/);
  const board = page.getByRole('region', { name: 'Documents board' });
  await expect(board).toBeVisible();

  // One column per document, by its canonical status; counts match.
  await expect(col(page, 'Drafts').locator(`[data-board-card="${draftId}"]`)).toBeVisible();
  await expect(col(page, 'Sent').locator(`[data-board-card="${sentId}"]`)).toBeVisible();
  await expect(board.locator('[data-board-card]')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Sent, 1 document' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Completed 0/ })).toBeVisible();

  // Dragging to another status changes nothing and explains why.
  await col(page, 'Sent')
    .locator(`[data-board-card="${sentId}"] time`)
    .dragTo(col(page, 'In Progress').getByText('No documents currently in progress.'));
  await expect(
    page.getByText('Document status updates automatically based on signing activity.'),
  ).toBeVisible();
  await expect(col(page, 'Sent').locator(`[data-board-card="${sentId}"]`)).toBeVisible();

  // The three-dot menu: status-specific actions, keyboard friendly, not clipped.
  await page.getByRole('button', { name: 'Actions for Consulting Proposal' }).click();
  const menu = page.getByRole('menu', { name: 'Actions for Consulting Proposal' });
  await expect(menu.getByRole('menuitem', { name: 'Send reminder' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Cancel request…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Download/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Actions for Vendor Contract' }).click();
  await expect(page.getByRole('menuitem', { name: 'Continue editing' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A card click opens the existing details drawer.
  await page.locator(`[data-board-card="${sentId}"] time`).click();
  const drawer = page.getByRole('dialog', { name: 'Consulting Proposal' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Search narrows the board; the view and search survive switching to List and back.
  await page
    .getByRole('searchbox', { name: 'Search documents, recipients, or reference' })
    .fill('vendor');
  await expect(page).toHaveURL(/q=vendor/);
  await expect(board.locator('[data-board-card]')).toHaveCount(1);
  // The board updates in place; the search box keeps focus while you type.
  await expect(
    page.getByRole('searchbox', { name: 'Search documents, recipients, or reference' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator(`tr[data-doc-id="${draftId}"]`)).toBeVisible();
  await expect(page.locator(`tr[data-doc-id="${sentId}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page).toHaveURL(/view=kanban/);
  await expect(page).toHaveURL(/q=vendor/);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(board.locator('[data-board-card]')).toHaveCount(2);

  // Metric cards focus one column.
  await page.getByRole('link', { name: /^Drafts 1/ }).click();
  await expect(page).toHaveURL(/status=drafts/);
  await expect(board.locator('section')).toHaveCount(1);
  await page.getByRole('link', { name: /^All documents 2/ }).click();

  // Columns collapse, and the choice is remembered.
  await page.getByRole('button', { name: 'Collapse Drafts' }).click();
  await expect(page.getByRole('button', { name: 'Expand Drafts, 1 document' })).toBeVisible();
  await page.goto('/app/documents');
  await expect(page.getByRole('button', { name: 'Expand Drafts, 1 document' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();

  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(axe.violations).toEqual([]);

  // The signer finishes; the card moves to Completed when the board catches up.
  const signer = await browser.newPage();
  await sign(signer, await latestLinkFor(email, 'Please sign'));
  await signer.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const done = col(page, 'Completed').locator(`[data-board-card="${sentId}"]`);
  await expect(done).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Actions for Consulting Proposal' }).click();
  await expect(page.getByRole('menuitem', { name: 'Download complete package' })).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'View Certificate of Completion' }),
  ).toHaveAttribute('href', /kind=certificate&view=1/);
});
