import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  getTeam,
  inviteMember,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  changeMemberRole,
  setMemberStatus,
  setMemberGroups,
  createGroup,
  saveCustomRole,
  deleteCustomRole,
  getMembership,
  createContact,
  updateContact,
  listContacts,
  mergeContacts,
  importContacts,
  exportContactsCsv,
  deleteContact,
  parseCsv,
  createTemplateFromUpload,
  saveTemplateRecipients,
  saveTemplateFields,
  publishTemplate,
  getTemplate,
  listTemplates,
  createDocumentFromTemplate,
  getDocument,
  setTemplateStatus,
  duplicateTemplate,
  saveBranding,
  uploadLogo,
  getBrand,
  readLogo,
  contrastWithWhite,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const LIMITS = { maxBytes: 10_000_000, maxPages: 50 };
let owner: string, admin: string, manager: string, viewer: string, outsider: string, ws: string;
let roleIds: Record<string, string> = {};

async function emailOf(id: string) {
  const [u] = await owner_.db
    .select()
    .from(schema.user)
    .where(sql`${schema.user.id} = ${id}`);
  return u!.email;
}
async function tokenFrom(mail: { token: string }) {
  return mail.token;
}

beforeAll(async () => {
  [owner, admin, manager, viewer, outsider] = (await Promise.all(
    ['t_owner', 't_admin', 't_manager', 't_viewer', 't_outsider'].map(makeUser),
  )) as [string, string, string, string, string];
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Team WS' })).id;
  await addMember(ws, admin, 'admin');
  await addMember(ws, manager, 'manager');
  await addMember(ws, viewer, 'viewer');
  const roles = await owner_.db
    .select()
    .from(schema.roles)
    .where(sql`${schema.roles.workspaceId} is null`);
  roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id]));
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('team', () => {
  it('lists members, roles and metrics for people who can view the team', async () => {
    const t = await getTeam(db, { userId: viewer }, ws);
    expect(t.metrics.total).toBe(4);
    expect(t.canManage).toBe(false);
    expect(t.roles.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Owner', 'Billing Administrator', 'API Developer']),
    );
    await expect(getTeam(db, { userId: outsider }, ws)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('invites by email; only the invited, verified address can accept; links are single use', async () => {
    const invitee = await makeUser('t_invitee');
    const email = await emailOf(invitee);
    const mail = await inviteMember(db, { userId: admin }, ws, {
      email,
      roleId: roleIds.editor!,
      expiresInDays: 7,
    });
    expect(mail.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The token itself is never stored.
    const [row] = await owner_.db
      .select()
      .from(schema.workspaceInvitations)
      .where(sql`${schema.workspaceInvitations.id} = ${mail.invitationId}`);
    expect(row!.tokenHash).not.toContain(mail.token);
    expect((await previewInvitation(db, null, mail.token))?.state).toBe('open');
    await expect(
      inviteMember(db, { userId: admin }, ws, { email, roleId: roleIds.editor! }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Someone else cannot use it.
    await expect(acceptInvitation(db, { userId: outsider }, mail.token)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const { workspaceId } = await acceptInvitation(db, { userId: invitee }, await tokenFrom(mail));
    expect(workspaceId).toBe(ws);
    expect((await getMembership(db, { userId: invitee }, ws)).roleKey).toBe('editor');
    await expect(acceptInvitation(db, { userId: invitee }, mail.token)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('resend replaces the link; revoke and expiry stop it', async () => {
    const a = await makeUser('t_inv2');
    const first = await inviteMember(db, { userId: owner }, ws, {
      email: await emailOf(a),
      roleId: roleIds.viewer!,
    });
    await owner_.db.execute(
      sql`update workspace_invitations set last_sent_at = now() - interval '2 minutes' where id = ${first.invitationId}::uuid`,
    );
    const second = await resendInvitation(db, { userId: owner }, first.invitationId);
    expect(second.token).not.toBe(first.token);
    expect(await previewInvitation(db, null, first.token)).toBeNull();
    await revokeInvitation(db, { userId: owner }, first.invitationId);
    await expect(acceptInvitation(db, { userId: a }, second.token)).rejects.toThrow(/cancelled/);

    const b = await makeUser('t_inv3');
    const exp = await inviteMember(db, { userId: owner }, ws, {
      email: await emailOf(b),
      roleId: roleIds.viewer!,
    });
    await owner_.db.execute(
      sql`update workspace_invitations set expires_at = now() - interval '1 minute' where id = ${exp.invitationId}::uuid`,
    );
    await expect(acceptInvitation(db, { userId: b }, exp.token)).rejects.toThrow(/expired/);
  });

  it('nobody can hand out more access than they have', async () => {
    // Admins cannot make owners; managers cannot invite at all.
    await expect(
      inviteMember(db, { userId: admin }, ws, {
        email: 'boss@example.test',
        roleId: roleIds.owner!,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      inviteMember(db, { userId: manager }, ws, {
        email: 'x@example.test',
        roleId: roleIds.viewer!,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The database refuses it too, even if the service check were skipped.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${admin}, true)`);
        await tx
          .insert(schema.workspaceMemberships)
          .values({ workspaceId: ws, userId: outsider, roleId: roleIds.owner! });
      }),
    ).rejects.toThrow();
    // Nobody can change their own role.
    const t = await getTeam(db, { userId: owner }, ws);
    const me = t.members.find((m) => m.userId === admin)!;
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${admin}, true)`);
        const r = await tx
          .update(schema.workspaceMemberships)
          .set({ roleId: roleIds.owner! })
          .where(sql`id = ${me.membershipId}::uuid`)
          .returning();
        if (!r.length) throw new Error('refused');
      }),
    ).rejects.toThrow();
    // Admins cannot touch the owner.
    const ownerRow = t.members.find((m) => m.userId === owner)!;
    await expect(
      setMemberStatus(db, { userId: admin }, ownerRow.membershipId, 'suspended'),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('custom roles only carry permissions the editor has, and can be assigned and removed', async () => {
    await expect(
      saveCustomRole(db, { userId: manager }, ws, null, {
        name: 'Sneaky',
        permissions: ['billing.manage'],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const { id } = await saveCustomRole(db, { userId: admin }, ws, null, {
      name: 'Contracts desk',
      description: 'Send and manage templates',
      permissions: [
        'documents.view_all',
        'documents.view_own',
        'documents.create',
        'documents.send',
        'templates.view',
      ],
    });
    const t = await getTeam(db, { userId: admin }, ws);
    const v = t.members.find((m) => m.userId === viewer)!;
    await changeMemberRole(db, { userId: admin }, v.membershipId, id);
    const m = await getMembership(db, { userId: viewer }, ws);
    expect(m.roleName).toBe('Contracts desk');
    expect(m.permissions).toContain('documents.send');
    await expect(deleteCustomRole(db, { userId: admin }, ws, id)).rejects.toMatchObject({
      code: 'conflict',
    });
    await changeMemberRole(db, { userId: admin }, v.membershipId, roleIds.viewer!);
    await deleteCustomRole(db, { userId: admin }, ws, id);
    // Built-in roles cannot be edited.
    await expect(
      saveCustomRole(db, { userId: owner }, ws, roleIds.viewer!, {
        name: 'Viewer 2',
        permissions: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('suspends, reactivates and removes members, keeps an owner, and organises groups', async () => {
    const t = await getTeam(db, { userId: owner }, ws);
    const v = t.members.find((m) => m.userId === viewer)!;
    await setMemberStatus(db, { userId: admin }, v.membershipId, 'suspended');
    await expect(getMembership(db, { userId: viewer }, ws)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await setMemberStatus(db, { userId: admin }, v.membershipId, 'active');
    const g = await createGroup(db, { userId: admin }, ws, 'Legal');
    await expect(createGroup(db, { userId: admin }, ws, 'legal')).rejects.toMatchObject({
      code: 'conflict',
    });
    await setMemberGroups(db, { userId: admin }, v.membershipId, [g.id]);
    const t2 = await getTeam(db, { userId: viewer }, ws);
    expect(t2.members.find((m) => m.userId === viewer)!.groups.map((x) => x.name)).toEqual([
      'Legal',
    ]);
    // Being in a group gives no extra permissions.
    expect((await getMembership(db, { userId: viewer }, ws)).permissions).not.toContain(
      'documents.send',
    );

    // A second owner can be removed, but never the last one.
    const second = await makeUser('t_owner2');
    await addMember(ws, second, 'owner');
    const t3 = await getTeam(db, { userId: owner }, ws);
    await setMemberStatus(
      db,
      { userId: owner },
      t3.members.find((m) => m.userId === second)!.membershipId,
      'removed',
    );
    const solo = await makeUser('t_solo');
    const ws2 = (await createWorkspace(db, { userId: solo }, { name: 'Solo WS' })).id;
    const helper = await makeUser('t_helper');
    await addMember(ws2, helper, 'owner');
    const t4 = await getTeam(db, { userId: helper }, ws2);
    await setMemberStatus(
      db,
      { userId: helper },
      t4.members.find((m) => m.userId === solo)!.membershipId,
      'removed',
    );
    await expect(
      owner_.db.execute(
        sql`update workspace_memberships set status = 'removed' where workspace_id = ${ws2}::uuid and user_id = ${helper}`,
      ),
    ).rejects.toThrow();
  });
});

describe('contacts', () => {
  it('creates, prevents duplicates, keeps private contacts private, and merges', async () => {
    const a = await createContact(db, { userId: manager }, ws, {
      name: 'Ada Venue',
      email: 'ADA@venue.test',
      company: 'Blue Room',
      tags: 'venue, Chicago',
    });
    expect(a.email).toBe('ada@venue.test');
    expect(a.tags).toEqual(['venue', 'chicago']);
    await expect(
      createContact(db, { userId: manager }, ws, { name: 'Ada 2', email: 'ada@venue.test' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const priv = await createContact(db, { userId: manager }, ws, {
      name: 'Private Pat',
      email: 'pat@x.test',
      visibility: 'private',
    });
    const seen = await listContacts(db, { userId: viewer }, ws);
    expect(seen.rows.map((r) => r.id)).toContain(a.id);
    expect(seen.rows.map((r) => r.id)).not.toContain(priv.id);
    // Viewers cannot edit.
    await expect(
      updateContact(db, { userId: viewer }, a.id, { name: 'X', email: 'ada@venue.test' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const b = await createContact(db, { userId: manager }, ws, {
      name: 'Ada V.',
      email: 'ada.v@venue.test',
      phone: '555-0100',
      tags: ['booking'],
    });
    const merged = await mergeContacts(db, { userId: manager }, a.id, b.id);
    expect(merged.phone).toBe('555-0100');
    expect(merged.tags).toEqual(expect.arrayContaining(['venue', 'chicago', 'booking']));
    expect((await listContacts(db, { userId: manager }, ws, { q: 'ada' })).rows).toHaveLength(1);
    await deleteContact(db, { userId: manager }, priv.id);
  });

  it('imports CSV, skips bad rows and existing addresses, and exports safely', async () => {
    const csv =
      'Name,Email,Company,Tags\r\n"Lee, Jr.",lee@x.test,"Acme ""Co""",a\r\nNo Email,,X,\r\nAda Again,ada@venue.test,,\r\n=HYPERLINK(1),evil@x.test,,\r\n';
    expect(parseCsv(csv)[1]).toEqual(['Lee, Jr.', 'lee@x.test', 'Acme "Co"', 'a']);
    const r = await importContacts(db, { userId: manager }, ws, csv);
    expect(r.created).toBe(2);
    expect(r.skipped.map((s) => s.row)).toEqual([3, 4]);
    const out = await exportContactsCsv(db, { userId: manager }, ws);
    expect(out).toContain('"Lee, Jr."');
    expect(out).toContain("'=HYPERLINK(1)");
    await expect(importContacts(db, { userId: manager }, ws, 'Foo,Bar\n1,2\n')).rejects.toThrow(
      /Name and Email/,
    );
  });
});

describe('templates', () => {
  let tplId: string;
  const ARTIST = crypto.randomUUID();
  const VENUE = crypto.randomUUID();

  it('creates a draft from a PDF, edits placeholders and fields, and publishes only when complete', async () => {
    await expect(
      createTemplateFromUpload(
        db,
        storage,
        { userId: viewer },
        {
          workspaceId: ws,
          title: 'X',
          category: 'Legal',
          documentType: 'agreement',
          filename: 'x.pdf',
          bytes: await makePdf(1),
        },
        LIMITS,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    tplId = (
      await createTemplateFromUpload(
        db,
        storage,
        { userId: manager },
        {
          workspaceId: ws,
          title: 'Performance Agreement',
          description: 'Standard gig contract',
          category: 'Booking & Events',
          documentType: 'agreement',
          filename: 'perf.pdf',
          bytes: await makePdf(2),
        },
        LIMITS,
      )
    ).id;
    await saveTemplateRecipients(
      db,
      { userId: manager },
      tplId,
      {
        signingOrderEnabled: true,
        recipients: [
          { id: ARTIST, label: 'Artist', role: 'signer', signingOrder: 1 },
          { id: VENUE, label: 'Venue', role: 'signer', signingOrder: 2 },
        ],
      },
      { maxSigners: 10 },
    );
    await saveTemplateFields(db, { userId: manager }, tplId, [
      { recipientId: ARTIST, type: 'signature', page: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 },
    ]);
    const blocked = await publishTemplate(db, { userId: manager }, tplId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.issues[0]!.message).toMatch(/Venue/);
    await saveTemplateFields(db, { userId: manager }, tplId, [
      { recipientId: ARTIST, type: 'signature', page: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 },
      { recipientId: VENUE, type: 'signature', page: 2, x: 0.5, y: 0.8, width: 0.2, height: 0.05 },
    ]);
    expect(await publishTemplate(db, { userId: manager }, tplId)).toEqual({ ok: true, version: 1 });
    const list = await listTemplates(db, { userId: viewer }, ws);
    expect(list.metrics.active).toBe(1);
    expect(list.rows[0]!.title).toBe('Performance Agreement');
  });

  it('using a template makes a draft with the people filled in and records the version', async () => {
    const { documentId } = await createDocumentFromTemplate(
      db,
      storage,
      { userId: manager },
      tplId,
      {
        title: 'Gig at Blue Room',
        recipients: [
          { placeholderId: ARTIST, name: 'Sol Artist', email: 'sol@x.test' },
          { placeholderId: VENUE, name: 'Blue Room', email: 'booking@blueroom.test' },
        ],
      },
    );
    const d = await getDocument(db, { userId: manager }, documentId);
    expect(d.recipients.map((r) => r.email)).toEqual(['sol@x.test', 'booking@blueroom.test']);
    expect(d.fields).toHaveLength(2);
    expect(d.document.signingOrderEnabled).toBe(true);
    const [doc] = await owner_.db
      .select()
      .from(schema.documents)
      .where(sql`${schema.documents.id} = ${documentId}::uuid`);
    const v1 = doc!.templateVersionId;
    expect(v1).toBeTruthy();
    // No signing request exists until someone sends it.
    const reqs = await owner_.db
      .select()
      .from(schema.signingRequests)
      .where(sql`${schema.signingRequests.documentId} = ${documentId}::uuid`);
    expect(reqs).toHaveLength(0);

    // Editing the active template makes version 2; the document keeps version 1.
    await saveTemplateFields(db, { userId: manager }, tplId, [
      { recipientId: ARTIST, type: 'signature', page: 1, x: 0.1, y: 0.7, width: 0.2, height: 0.05 },
      { recipientId: VENUE, type: 'signature', page: 2, x: 0.5, y: 0.7, width: 0.2, height: 0.05 },
    ]);
    const t = await getTemplate(db, { userId: manager }, tplId);
    expect(t.draft?.version).toBe(2);
    expect(t.published?.version).toBe(1);
    expect(t.history[0]!.uses).toBe(1);
    await publishTemplate(db, { userId: manager }, tplId);
    const [again] = await owner_.db
      .select()
      .from(schema.documents)
      .where(sql`${schema.documents.id} = ${documentId}::uuid`);
    expect(again!.templateVersionId).toBe(v1);
    // Published versions cannot be changed, even directly.
    const changed = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${manager}, true)`);
      return tx
        .update(schema.templateVersions)
        .set({ fields: [] })
        .where(sql`id = ${v1}::uuid`)
        .returning();
    });
    expect(changed).toHaveLength(0);
  });

  it('requires every placeholder, keeps private templates private, and archives', async () => {
    await expect(
      createDocumentFromTemplate(db, storage, { userId: manager }, tplId, {
        title: 'Missing venue',
        recipients: [{ placeholderId: ARTIST, name: 'A', email: 'a@x.test' }],
      }),
    ).rejects.toThrow(/Venue/);
    const copy = await duplicateTemplate(db, { userId: manager }, tplId);
    const t = await getTemplate(db, { userId: manager }, copy.id);
    await (
      await import('../src')
    ).saveTemplateDetails(db, { userId: manager }, copy.id, {
      title: t.template.title,
      category: 'Legal',
      documentType: 'agreement',
      shared: false,
    });
    await expect(getTemplate(db, { userId: viewer }, copy.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await setTemplateStatus(db, { userId: manager }, tplId, 'archive');
    await expect(
      createDocumentFromTemplate(db, storage, { userId: manager }, tplId, {
        title: 'x',
        recipients: [{ placeholderId: ARTIST, name: 'A', email: 'a@x.test' }],
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (await listTemplates(db, { userId: manager }, ws, { tab: 'archived' })).rows,
    ).toHaveLength(1);
  });
});

describe('branding', () => {
  it('saves readable colours and PNG/JPEG logos only', async () => {
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1);
    await expect(
      saveBranding(db, { userId: owner }, ws, { brandColor: '#ffee00' }),
    ).rejects.toThrow(/too light/);
    await expect(
      saveBranding(db, { userId: manager }, ws, { brandColor: '#7a1e3a' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await saveBranding(db, { userId: owner }, ws, {
      brandName: 'Team Records',
      brandColor: '#7A1E3A',
    });
    await expect(
      uploadLogo(
        db,
        storage,
        { userId: owner },
        ws,
        new TextEncoder().encode('<svg onload=alert(1)>'),
      ),
    ).rejects.toThrow(/PNG or JPEG/);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await uploadLogo(db, storage, { userId: owner }, ws, pngBytes);
    const brand = await getBrand(db, ws);
    expect(brand).toMatchObject({ brandName: 'Team Records', color: '#7a1e3a', hasLogo: true });
    expect((await readLogo(db, storage, ws)).type).toBe('image/png');
  });
});
