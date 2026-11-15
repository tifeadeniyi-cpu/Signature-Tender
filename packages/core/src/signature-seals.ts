import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { schema, withActor, type ActorContext, type Database } from '@st/db';
import { getDocument, signatureBlockSettings } from './documents';
import { signingEventRef } from './signing';
import { roleLabel, type SignatureDisplayFormat } from './signature-block/layout';

export interface SealField {
  fieldId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signerName: string;
  role: string;
  /** Server time the signing event was recorded (ISO, UTC). */
  signedAt: string;
  eventRef: string | null;
}

export interface SealInfo {
  requestId: string;
  format: SignatureDisplayFormat;
  timeZone: string;
  fields: SealField[];
}

/**
 * The signature blocks on a completed request's signed copy, for the viewer's seal panel. Only
 * people who can open the document get this (document permissions are checked first), and it
 * carries no tokens, IP addresses or other evidence beyond what the certificate shows them.
 */
export async function getSignatureSeals(
  db: Database,
  actor: ActorContext,
  documentId: string,
  requestId: string,
): Promise<SealInfo | null> {
  await getDocument(db, actor, documentId); // throws not_found without access
  return withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(
        and(
          eq(schema.signingRequests.id, requestId),
          eq(schema.signingRequests.documentId, documentId),
        ),
      );
    if (!req || req.status !== 'completed') return null;
    const rows = await tx
      .select({
        id: schema.requestFields.id,
        type: schema.requestFields.type,
        page: schema.requestFields.page,
        x: schema.requestFields.x,
        y: schema.requestFields.y,
        width: schema.requestFields.width,
        height: schema.requestFields.height,
        recipientId: schema.requestFields.recipientId,
        name: schema.requestRecipients.name,
        role: schema.requestRecipients.role,
        signedAt: schema.requestRecipients.signedAt,
      })
      .from(schema.requestFields)
      .innerJoin(
        schema.requestRecipients,
        eq(schema.requestRecipients.id, schema.requestFields.recipientId),
      )
      .where(
        and(
          eq(schema.requestFields.requestId, requestId),
          eq(schema.requestFields.type, 'signature'),
          isNotNull(schema.requestFields.signatureId),
        ),
      )
      .orderBy(asc(schema.requestFields.page), asc(schema.requestFields.y));
    const events = await tx
      .select({
        seq: schema.signingEvents.seq,
        type: schema.signingEvents.type,
        recipientId: schema.signingEvents.recipientId,
        hash: schema.signingEvents.hash,
      })
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId))
      .orderBy(asc(schema.signingEvents.seq));
    const block = signatureBlockSettings(req.settings);
    return {
      requestId,
      format: block.format,
      timeZone: block.timeZone,
      fields: rows
        .filter((r) => r.signedAt)
        .map((r) => ({
          fieldId: r.id,
          page: r.page,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          signerName: r.name,
          role: roleLabel(r.role),
          signedAt: r.signedAt!.toISOString(),
          eventRef: signingEventRef(events, r.recipientId),
        })),
    };
  });
}
