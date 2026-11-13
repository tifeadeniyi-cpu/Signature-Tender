import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import path from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { createDb, schema, withStudio } from '@st/db';
import { MemoryStorage, sha256Hex } from '../src';
import {
  DEFAULT_STUDIO_SETTINGS,
  DEFAULT_SMART,
  STYLE_FAMILIES,
  STUDIO_FONTS,
  assertSafeSvg,
  beginStudioCheckout,
  attachStudioCheckout,
  applyStudioCheckoutCompleted,
  applyStudioCheckoutClosed,
  applyStudioReversal,
  canonicalJson,
  claimGuestDrafts,
  deleteDesign,
  duplicateDesign,
  emptyDesign,
  generateVariations,
  getDesign,
  hasTransparency,
  hitRateLimit,
  listLibrary,
  newElement,
  nodeFontLoader,
  normalizeDesign,
  readStudioAsset,
  renderDesign,
  saveDraft,
  setDefaultDesign,
  storeUpload,
  svgToJpeg,
  svgToPng,
  toSvg,
  unsupportedChars,
  zip,
  type Design,
} from '../src/studio/server';
import { APP_URL, OWNER_URL } from './env';
import { makeUser } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const fonts = nodeFontLoader(path.resolve(__dirname, '../../../apps/web/public/studio-fonts'));
const deps = { fonts, storage };
const settings = DEFAULT_STUDIO_SETTINGS;
const RUN = Date.now().toString(36);
let seq = 0;
const sessionId = () => `cs_test_studio_${RUN}_${++seq}`;

function typed(value = 'Jordan Lee'): Design {
  const d = emptyDesign();
  d.text!.value = value;
  d.elements.push(newElement('u-long-sweep', 'e0001', { x: 600, y: 290, scale: 0.9 }));
  return normalizeDesign(d);
}

afterAll(async () => {
  await close();
  await owner.close();
});

describe('renderer', () => {
  it('renders the same design to the same SVG every time', async () => {
    const f = await fonts(['great-vibes']);
    const a = toSvg(renderDesign(typed(), f));
    const b = toSvg(renderDesign(normalizeDesign(JSON.parse(JSON.stringify(typed()))), f));
    expect(a).toBe(b);
    expect(sha256Hex(canonicalJson(typed()))).toBe(sha256Hex(canonicalJson(typed())));
  });

  it('turns typed text into vector outlines with no font or text in the SVG', async () => {
    const svg = toSvg(renderDesign(typed(), await fonts(['great-vibes'])));
    expect(svg).not.toMatch(/<text|font-family|Jordan/);
    expect(svg).toMatch(/<path d="M/);
    assertSafeSvg(svg);
  });

  it('exports a PNG with a transparent background and a JPEG on the chosen colour', async () => {
    const svg = toSvg(renderDesign(typed(), await fonts(['great-vibes'])));
    expect(hasTransparency(svg)).toBe(true);
    const png = svgToPng(svg, 1200);
    expect(png.width).toBe(1200);
    expect(png.png.subarray(1, 4).toString()).toBe('PNG');
    const jpg = svgToJpeg(svg, 800, '#FFFFFF');
    expect(jpg.jpeg[0]).toBe(0xff);
    expect(jpg.jpeg[1]).toBe(0xd8);
  });

  it('renders every style family and every font with full Latin coverage', async () => {
    for (const fam of STYLE_FAMILIES)
      for (const v of fam.variants) {
        const d = typed('Alex Morgan');
        d.text!.font = v.font;
        const r = renderDesign(d, await fonts([v.font]));
        expect(r.paths.length, `${fam.id}/${v.font}`).toBeGreaterThan(0);
        expect(r.missingFonts).toEqual([]);
      }
    for (const font of STUDIO_FONTS) {
      const f = (await fonts([font.id])).get(font.id)!;
      expect(unsupportedChars(f, "Taylor Smith-O'Neil & Zoë"), font.id).toEqual([]);
    }
  });

  it('reports characters a font cannot draw instead of substituting them', async () => {
    const f = (await fonts(['great-vibes'])).get('great-vibes')!;
    expect(unsupportedChars(f, 'Jordan 李')).toEqual(['李']);
  });

  it('generates the same variations for the same design and round', () => {
    const a = generateVariations(typed(), 1).map((d) => canonicalJson(d));
    const b = generateVariations(typed(), 1).map((d) => canonicalJson(d));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('keeps the raw freehand stroke when Smart Stroke refines it', async () => {
    const d = typed();
    const pts: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [-200 + i * 10, Math.sin(i) * 8, 0.5]);
    d.elements.push({ ...newElement('freehand', 'f0001', { x: 600, y: 300, scale: 1 }), points: pts, smart: DEFAULT_SMART });
    const n = normalizeDesign(d);
    renderDesign(n, await fonts(['great-vibes']));
    expect(n.elements[1]!.points).toEqual(pts.map(([x, y, p]) => [x, Math.round(y * 10) / 10, p]));
  });

  it('rejects unsafe SVG', () => {
    expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toThrow();
    expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path onload="x" d="M0 0"/></svg>')).toThrow();
    expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a.png"/></svg>')).toThrow();
  });

  it('builds a valid zip', () => {
    const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
  });
});

describe('purchases', () => {
  let alice: string, bob: string;
  beforeAll(async () => {
    alice = await makeUser('studio_alice');
    bob = await makeUser('studio_bob');
  });

  async function paidDesign(userId = alice) {
    const { id } = await saveDraft(db, { userId }, { design: typed() }, settings);
    const plan = await beginStudioCheckout(db, userId, id, settings);
    const sid = sessionId();
    await attachStudioCheckout(db, userId, plan.purchaseId, sid);
    const out = await applyStudioCheckoutCompleted(db, {
      sessionId: sid,
      paymentStatus: 'paid',
      amountSubtotal: 99,
      currency: 'usd',
      paymentIntentId: `pi_${RUN}_${seq}`,
      customerEmail: null,
    });
    return { id, plan, sid, out, pi: `pi_${RUN}_${seq}` };
  }

  it('moves guest drafts to the account at sign-in and hides them from other guests', async () => {
    const guest = sha256Hex(`guest-${RUN}`);
    const { id } = await saveDraft(db, { guestHash: guest }, { design: typed() }, settings);
    expect(await getDesign(db, { guestHash: sha256Hex('someone-else') }, id)).toBeNull();
    expect(await getDesign(db, { guestHash: guest }, id)).not.toBeNull();
    expect(await claimGuestDrafts(db, alice, guest)).toBe(1);
    const row = await getDesign(db, { userId: alice }, id);
    expect(row?.ownerUserId).toBe(alice);
    expect(await getDesign(db, { guestHash: guest }, id)).toBeNull();
  });

  it('charges the price from settings and unlocks only after the webhook says paid', async () => {
    const { id } = await saveDraft(db, { userId: alice }, { design: typed() }, settings);
    const plan = await beginStudioCheckout(db, alice, id, settings);
    expect(plan.amountCents).toBe(99);
    const sid = sessionId();
    await attachStudioCheckout(db, alice, plan.purchaseId, sid);
    await expect(readStudioAsset(db, deps, alice, id, 'png', settings)).rejects.toThrow(/Buy this design/);
    const pending = await applyStudioCheckoutCompleted(db, {
      sessionId: sid, paymentStatus: 'unpaid', amountSubtotal: 99, currency: 'usd', paymentIntentId: null, customerEmail: null,
    });
    expect(pending.action).toBe('none');
    await expect(readStudioAsset(db, deps, alice, id, 'png', settings)).rejects.toThrow(/Buy this design/);
  });

  it('refuses to unlock when the paid amount does not match', async () => {
    const { id } = await saveDraft(db, { userId: alice }, { design: typed() }, settings);
    const plan = await beginStudioCheckout(db, alice, id, settings);
    const sid = sessionId();
    await attachStudioCheckout(db, alice, plan.purchaseId, sid);
    await expect(
      applyStudioCheckoutCompleted(db, { sessionId: sid, paymentStatus: 'paid', amountSubtotal: 1, currency: 'usd', paymentIntentId: 'pi_x', customerEmail: null }),
    ).rejects.toThrow(/amount/);
  });

  it('fulfils once, freezes the design and serves the files only to the owner', async () => {
    const { id, sid, out } = await paidDesign();
    expect(out.action).toBe('fulfil');
    // Webhook retries are harmless.
    const again = await applyStudioCheckoutCompleted(db, {
      sessionId: sid, paymentStatus: 'paid', amountSubtotal: 99, currency: 'usd', paymentIntentId: 'pi_retry', customerEmail: null,
    });
    expect(again.action).toBe('fulfil');
    const ents = await owner.db.select().from(schema.signatureEntitlements).where(eq(schema.signatureEntitlements.signatureDesignId, id));
    expect(ents).toHaveLength(1);

    const png = await readStudioAsset(db, deps, alice, id, 'png', settings);
    expect(png.contentType).toBe('image/png');
    const svg = await readStudioAsset(db, deps, alice, id, 'svg', settings);
    assertSafeSvg(svg.body.toString('utf8'));
    await expect(readStudioAsset(db, deps, bob, id, 'png', settings)).rejects.toThrow();
    expect(await getDesign(db, { userId: bob }, id)).toBeNull();

    // Editing a purchased design never changes it: the save becomes a new draft.
    const edit = await saveDraft(db, { userId: alice }, { id, design: typed('Alex Morgan') }, settings);
    expect(edit.id).not.toBe(id);
    // Even a direct update is refused by the database.
    await expect(
      withStudio(db, { userId: alice }, (tx) =>
        tx.update(schema.signatureDesigns).set({ design: {} }).where(eq(schema.signatureDesigns.id, id)),
      ),
    ).rejects.toThrow();
    await expect(beginStudioCheckout(db, alice, id, settings)).rejects.toThrow(/already own/);

    await setDefaultDesign(db, alice, id);
    const lib = await listLibrary(db, alice);
    expect(lib.find((d) => d.id === id)).toMatchObject({ status: 'purchased', isDefault: true, access: 'active' });
    const copy = await duplicateDesign(db, alice, id, settings);
    expect((await getDesign(db, { userId: alice }, copy.id))?.status).toBe('draft');
  });

  it('refunds a second payment for the same design instead of granting it twice', async () => {
    const { id } = await saveDraft(db, { userId: alice }, { design: typed() }, settings);
    const p1 = await beginStudioCheckout(db, alice, id, settings);
    const p2 = await beginStudioCheckout(db, alice, id, settings);
    const s1 = sessionId();
    const s2 = sessionId();
    await attachStudioCheckout(db, alice, p1.purchaseId, s1);
    await attachStudioCheckout(db, alice, p2.purchaseId, s2);
    const facts = { paymentStatus: 'paid', amountSubtotal: 99, currency: 'usd', customerEmail: null };
    expect((await applyStudioCheckoutCompleted(db, { ...facts, sessionId: s1, paymentIntentId: `pi_a_${RUN}` })).action).toBe('fulfil');
    expect((await applyStudioCheckoutCompleted(db, { ...facts, sessionId: s2, paymentIntentId: `pi_b_${RUN}` })).action).toBe('refund_duplicate');
  });

  it('revokes access on a full refund or dispute, but not on a partial refund', async () => {
    const a = await paidDesign();
    expect((await applyStudioReversal(db, { paymentIntentId: a.pi, kind: 'refund', amountRefunded: 50 })).revoked).toBe(false);
    await readStudioAsset(db, deps, alice, a.id, 'png', settings);
    expect((await applyStudioReversal(db, { paymentIntentId: a.pi, kind: 'refund', amountRefunded: 99 })).revoked).toBe(true);
    await expect(readStudioAsset(db, deps, alice, a.id, 'png', settings)).rejects.toThrow(/Buy this design/);
    const b = await paidDesign();
    expect((await applyStudioReversal(db, { paymentIntentId: b.pi, kind: 'dispute' })).revoked).toBe(true);
  });

  it('leaves the design a draft when checkout expires', async () => {
    const { id } = await saveDraft(db, { userId: alice }, { design: typed() }, settings);
    const plan = await beginStudioCheckout(db, alice, id, settings);
    const sid = sessionId();
    await attachStudioCheckout(db, alice, plan.purchaseId, sid);
    expect(await applyStudioCheckoutClosed(db, sid, 'expired')).not.toBeNull();
    expect((await getDesign(db, { userId: alice }, id))?.status).toBe('draft');
    await deleteDesign(db, alice, id);
  });

  it('stores uploads with metadata removed and limits requests', async () => {
    const svg = toSvg(renderDesign(typed(), await fonts(['great-vibes'])));
    const { png } = svgToPng(svg, 600);
    const up = await storeUpload(db, storage, { userId: alice }, png);
    expect(up.ref).toMatch(/^[0-9a-f]{64}$/);
    await expect(storeUpload(db, storage, { userId: alice }, Buffer.from('not an image at all, just text padding....................'))).rejects.toThrow();
    const key = `test:${RUN}`;
    expect(await hitRateLimit(db, key, 2)).toBe(true);
    expect(await hitRateLimit(db, key, 2)).toBe(true);
    expect(await hitRateLimit(db, key, 2)).toBe(false);
  });

  it('keeps purchases private between accounts', async () => {
    const rows = await withStudio(db, { userId: bob }, (tx) => tx.select().from(schema.signaturePurchases));
    expect(rows.every((r) => r.ownerUserId === bob)).toBe(true);
    const ents = await withStudio(db, { userId: bob }, (tx) => tx.execute(sql`select * from signature_entitlements`));
    expect((ents as unknown as unknown[]).length).toBe(0);
  });
});
