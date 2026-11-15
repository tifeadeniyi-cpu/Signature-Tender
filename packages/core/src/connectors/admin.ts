import { sql } from 'drizzle-orm';
import { withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from '../errors';
import { getConnector } from './registry';
import type { Availability } from './types';

/**
 * Staff controls. The database functions check platform staff and audit every change. They return
 * counts only: staff never see customer tokens, accounts or agreements here.
 */
export async function setIntegrationAvailability(
  db: Database,
  actor: ActorContext,
  provider: string,
  availability: Availability | null,
) {
  if (!getConnector(provider)) throw new AppError('not_found', 'Unknown integration.');
  try {
    await withActor(db, actor, (tx) =>
      tx.execute(sql`select st_integration_set_availability(${provider}, ${availability})`),
    );
  } catch (err) {
    if (
      String(
        (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code,
      ) === '42501'
    )
      throw new AppError('forbidden', 'Only platform staff can change integrations.');
    throw err;
  }
}

export interface IntegrationAdminRow {
  provider: string;
  connections: number;
  active: number;
  needs_attention: number;
  jobs_failed_7d: number;
  jobs_succeeded_7d: number;
  envelopes_linked_30d: number;
}

export async function getIntegrationAdminOverview(
  db: Database,
  actor: ActorContext,
): Promise<IntegrationAdminRow[]> {
  return (await withActor(db, actor, (tx) =>
    tx.execute(sql`select * from st_integration_admin_overview()`),
  )) as unknown as IntegrationAdminRow[];
}
