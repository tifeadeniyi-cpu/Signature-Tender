import { schema, type Tx } from '@st/db';

export interface AuditInput {
  workspaceId?: string | null;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const ACTION_RE = /^[a-z_]+(\.[a-z_]+)+$/;

/** Writes an audit event inside the caller's transaction so the change and its record commit together. */
export async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  if (!ACTION_RE.test(input.action)) throw new Error(`Invalid audit action: ${input.action}`);
  await tx.insert(schema.auditEvents).values({
    workspaceId: input.workspaceId ?? null,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export { ACTION_RE };
