import { and, desc, eq } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { z } from 'zod';
import { AppError } from '../errors';
import { recordAudit } from '../audit';
import { WEBHOOK_EVENTS } from '../webhooks';
import { getConnector } from './registry';
import { sanitizeMetadata } from './activity';

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export const automationInput = z.object({
  connectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  eventType: z.enum(WEBHOOK_EVENTS),
  action: z.string().min(1).max(80),
  configuration: z
    .record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()]))
    .default({}),
});

/**
 * Creates an automation: "when <event> happens, run <action> on this connection". The action must
 * be one the connector declares for that event. Runs with the creator's permissions.
 */
export async function createAutomation(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: z.input<typeof automationInput>,
  meta: Meta = {},
) {
  const input = automationInput.parse(raw);
  return withActor(db, actor, async (tx) => {
    const [conn] = await tx
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.id, input.connectionId),
          eq(schema.integrationConnections.workspaceId, workspaceId),
        ),
      );
    if (!conn) throw new AppError('not_found', 'This connection was not found.');
    if (conn.status === 'disabled') throw new AppError('invalid', 'Reconnect the app first.');
    const def = getConnector(conn.provider);
    const action = def?.actions.find((a) => a.key === input.action);
    if (!def?.implemented || !action)
      throw new AppError('invalid', 'This app does not offer that action.');
    if (!action.runsOn.includes(input.eventType))
      throw new AppError('invalid', `“${action.label}” cannot run on that event.`);
    const [row] = await tx
      .insert(schema.integrationEventSubscriptions)
      .values({
        workspaceId,
        connectionId: input.connectionId,
        name: input.name,
        eventType: input.eventType,
        action: input.action,
        configuration: sanitizeMetadata(input.configuration),
        createdBy: actor.userId!,
      })
      .returning({ id: schema.integrationEventSubscriptions.id });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.automation_created',
      targetType: 'integration_automation',
      targetId: row!.id,
      metadata: { provider: conn.provider, event: input.eventType, action: input.action },
      ...meta,
    });
    return row!.id;
  });
}

async function updateAutomation(
  db: Database,
  actor: ActorContext,
  id: string,
  set: Partial<typeof schema.integrationEventSubscriptions.$inferInsert>,
  auditAction: string,
  meta: Meta,
) {
  await withActor(db, actor, async (tx) => {
    const res = await tx
      .update(schema.integrationEventSubscriptions)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.integrationEventSubscriptions.id, id))
      .returning();
    const a = res[0];
    if (!a) throw new AppError('forbidden', 'You cannot change this automation.');
    await recordAudit(tx, {
      workspaceId: a.workspaceId,
      actorUserId: actor.userId,
      action: auditAction,
      targetType: 'integration_automation',
      targetId: id,
      ...meta,
    });
  });
}

export async function setAutomationEnabled(
  db: Database,
  actor: ActorContext,
  id: string,
  enabled: boolean,
  meta: Meta = {},
) {
  if (enabled) {
    // Turning back on needs a working connection.
    const [row] = await withActor(db, actor, (tx) =>
      tx
        .select({ status: schema.integrationConnections.status })
        .from(schema.integrationEventSubscriptions)
        .innerJoin(
          schema.integrationConnections,
          eq(schema.integrationConnections.id, schema.integrationEventSubscriptions.connectionId),
        )
        .where(eq(schema.integrationEventSubscriptions.id, id)),
    );
    if (row?.status === 'disabled') throw new AppError('invalid', 'Reconnect the app first.');
  }
  await updateAutomation(
    db,
    actor,
    id,
    { enabled },
    enabled ? 'integration.automation_enabled' : 'integration.automation_disabled',
    meta,
  );
}

export async function deleteAutomation(
  db: Database,
  actor: ActorContext,
  id: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const res = await tx
      .delete(schema.integrationEventSubscriptions)
      .where(eq(schema.integrationEventSubscriptions.id, id))
      .returning();
    const a = res[0];
    if (!a) throw new AppError('forbidden', 'You cannot delete this automation.');
    await recordAudit(tx, {
      workspaceId: a.workspaceId,
      actorUserId: actor.userId,
      action: 'integration.automation_deleted',
      targetType: 'integration_automation',
      targetId: id,
      ...meta,
    });
  });
}

/** Copies an automation, switched off, so it can be edited before it runs. */
export async function duplicateAutomation(
  db: Database,
  actor: ActorContext,
  id: string,
  meta: Meta = {},
) {
  const [a] = await withActor(db, actor, (tx) =>
    tx
      .select()
      .from(schema.integrationEventSubscriptions)
      .where(eq(schema.integrationEventSubscriptions.id, id)),
  );
  if (!a) throw new AppError('not_found', 'This automation was not found.');
  const newId = await createAutomation(
    db,
    actor,
    a.workspaceId,
    {
      connectionId: a.connectionId,
      name: `${a.name} (copy)`.slice(0, 120),
      eventType: a.eventType as (typeof WEBHOOK_EVENTS)[number],
      action: a.action,
      configuration: a.configuration as Record<string, string>,
    },
    meta,
  );
  await setAutomationEnabled(db, actor, newId, false, meta);
  return newId;
}

export async function listAutomations(db: Database, actor: ActorContext, workspaceId: string) {
  const s = schema.integrationEventSubscriptions;
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: s.id,
        name: s.name,
        connectionId: s.connectionId,
        provider: schema.integrationConnections.provider,
        connectionLabel: schema.integrationConnections.externalAccountLabel,
        eventType: s.eventType,
        action: s.action,
        enabled: s.enabled,
        configuration: s.configuration,
        lastRunAt: s.lastRunAt,
        runCount: s.runCount,
        failureCount: s.failureCount,
        createdAt: s.createdAt,
      })
      .from(s)
      .innerJoin(
        schema.integrationConnections,
        eq(schema.integrationConnections.id, s.connectionId),
      )
      .where(eq(s.workspaceId, workspaceId))
      .orderBy(desc(s.createdAt)),
  );
}
