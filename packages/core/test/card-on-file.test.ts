import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  inviteMember,
  getCardOnFile,
  beginCardSetup,
  recordCardOnFile,
  clearCardOnFile,
  CARD_REQUIRED_MESSAGE,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember } from './helpers';

/** Companies must keep a card on file to add team members (when payments are live). */

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
let owner: string, manager: string, ws: string, editorRole: string;
const ON = { cardRequired: true };

beforeAll(async () => {
  owner = await makeUser('card_owner');
  manager = await makeUser('card_manager');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Card Co' })).id;
  await addMember(ws, manager, 'manager');
  const [r] = await owner_.db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.key} = 'editor' and ${schema.roles.workspaceId} is null`);
  editorRole = r!.id;
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('card on file for teams', () => {
  it('blocks invitations until the company saves a card, then allows them', async () => {
    expect(await getCardOnFile(db, { userId: owner }, ws)).toEqual({
      required: true,
      hasCard: false,
      brand: null,
      last4: null,
    });
    await expect(
      inviteMember(db, { userId: owner }, ws, { email: 'new.hire@example.test', roleId: editorRole }, {}, ON),
    ).rejects.toMatchObject({ code: 'conflict', message: CARD_REQUIRED_MESSAGE });
    // Without live payments the rule is off (nobody could add a card).
    await inviteMember(db, { userId: owner }, ws, { email: 'early.hire@example.test', roleId: editorRole });

    // Only billing managers start the card setup.
    await expect(beginCardSetup(db, { userId: manager }, ws)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await beginCardSetup(db, { userId: owner }, ws)).toMatchObject({ customerId: null });

    await owner_.db.insert(schema.billingAccounts).values({ workspaceId: ws, stripeCustomerId: `cus_card${Date.now()}` });
    const [acct] = await owner_.db
      .select()
      .from(schema.billingAccounts)
      .where(sql`${schema.billingAccounts.workspaceId} = ${ws}`);
    // A card for some other Stripe customer is ignored.
    expect(
      await recordCardOnFile(db, { workspaceId: ws, customerId: 'cus_someoneelse', paymentMethodId: 'pm_x', brand: 'visa', last4: '1111' }),
    ).toBe(false);
    expect(
      await recordCardOnFile(db, { workspaceId: ws, customerId: acct!.stripeCustomerId!, paymentMethodId: 'pm_card1', brand: 'visa', last4: '4242' }),
    ).toBe(true);
    // Team managers see it too (so the Team page can explain), without billing access.
    expect(await getCardOnFile(db, { userId: manager }, ws)).toMatchObject({ hasCard: true, brand: 'visa', last4: '4242' });
    await inviteMember(db, { userId: owner }, ws, { email: 'new.hire@example.test', roleId: editorRole }, {}, ON);

    // Removing the card in Stripe blocks new invitations again.
    expect(await clearCardOnFile(db, 'pm_card1')).toBe(true);
    await expect(
      inviteMember(db, { userId: owner }, ws, { email: 'third.hire@example.test', roleId: editorRole }, {}, ON),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('an active subscription counts as a card on file', async () => {
    const o = await makeUser('card_sub_owner');
    const w = (await createWorkspace(db, { userId: o }, { name: 'Sub Co' })).id;
    await owner_.db.insert(schema.billingAccounts).values({
      workspaceId: w,
      stripeCustomerId: `cus_sub${Date.now()}`,
      stripeSubscriptionId: `sub_${Date.now()}`,
      subscriptionStatus: 'active',
      planCode: 'pro',
    });
    expect((await getCardOnFile(db, { userId: o }, w)).hasCard).toBe(true);
  });
});
