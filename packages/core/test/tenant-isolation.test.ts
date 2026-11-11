import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createDb, withActor, schema } from '@st/db';
import {
  createWorkspace,
  getMembership,
  updateWorkspace,
  listMyWorkspaces,
  listAuditEvents,
  updateProfile,
  getProfile,
  AppError,
} from '../src';
import { APP_URL } from './env';
import { makeUser } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
let alice: string;
let bob: string;
let aliceWs: string;

beforeAll(async () => {
  alice = await makeUser('alice');
  bob = await makeUser('bob');
  aliceWs = (await createWorkspace(db, { userId: alice }, { name: 'Alice Studio' })).id;
});
afterAll(() => close());

describe('workspace creation', () => {
  it('makes the creator the owner and writes an audit event', async () => {
    const m = await getMembership(db, { userId: alice }, aliceWs);
    expect(m.roleKey).toBe('owner');
    expect(m.permissions).toContain('workspace.manage');
    const events = await listAuditEvents(db, { userId: alice }, aliceWs);
    expect(events.map((e) => e.action)).toContain('workspace.created');
  });
});

describe('row-level security', () => {
  it('hides other tenants rows from list queries', async () => {
    const bobs = await listMyWorkspaces(db, { userId: bob });
    expect(bobs.find((w) => w.id === aliceWs)).toBeUndefined();
    const raw = await withActor(db, { userId: bob }, (tx) => tx.select().from(schema.workspaces));
    expect(raw.find((w) => w.id === aliceWs)).toBeUndefined();
  });

  it('returns forbidden when guessing another workspace id (IDOR)', async () => {
    await expect(getMembership(db, { userId: bob }, aliceWs)).rejects.toBeInstanceOf(AppError);
    await expect(
      updateWorkspace(db, { userId: bob }, aliceWs, { name: 'Owned' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('blocks direct SQL updates to another tenant even without the service layer', async () => {
    const res = await withActor(db, { userId: bob }, (tx) =>
      tx
        .update(schema.workspaces)
        .set({ name: 'pwned' })
        .where(eq(schema.workspaces.id, aliceWs))
        .returning(),
    );
    expect(res).toHaveLength(0);
  });

  it('blocks self-joining another workspace', async () => {
    await expect(
      withActor(db, { userId: bob }, async (tx) => {
        const [role] = await tx
          .select()
          .from(schema.roles)
          .where(sql`${schema.roles.key} = 'owner' and ${schema.roles.workspaceId} is null`);
        await tx
          .insert(schema.workspaceMemberships)
          .values({ workspaceId: aliceWs, userId: bob, roleId: role!.id });
      }),
    ).rejects.toThrow();
  });

  it('sees nothing without an actor bound', async () => {
    const rows = await db.select().from(schema.workspaces);
    expect(rows).toHaveLength(0);
  });

  it('keeps the audit log append-only for the app role', async () => {
    await expect(
      withActor(db, { userId: alice }, (tx) => tx.delete(schema.auditEvents)),
    ).rejects.toThrow();
    await expect(
      withActor(db, { userId: alice }, (tx) =>
        tx.update(schema.auditEvents).set({ action: 'x.y' }),
      ),
    ).rejects.toThrow();
  });

  it('prevents reading another tenants audit events', async () => {
    const events = await listAuditEvents(db, { userId: bob }, aliceWs);
    expect(events).toHaveLength(0);
  });
});

describe('workspace and profile updates', () => {
  it('owner can update workspace settings', async () => {
    await updateWorkspace(db, { userId: alice }, aliceWs, {
      name: 'Alice Studio LLC',
      website: 'https://alice.example',
    });
    const m = await getMembership(db, { userId: alice }, aliceWs);
    expect(m.workspace.name).toBe('Alice Studio LLC');
  });

  it('profile is private to its user', async () => {
    await updateProfile(
      db,
      { userId: alice },
      { name: 'Alice A', jobTitle: 'Producer', timezone: 'America/New_York' },
    );
    expect((await getProfile(db, { userId: alice })).jobTitle).toBe('Producer');
    const rows = await withActor(db, { userId: bob }, (tx) =>
      tx.select().from(schema.userProfiles),
    );
    expect(rows.find((r) => r.userId === alice)).toBeUndefined();
  });
});
