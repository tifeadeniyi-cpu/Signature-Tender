import 'server-only';
import { z } from 'zod';
import {
  getDocument,
  getProfile,
  getRequestsForDocument,
  isFeatureEnabled,
  listMyWorkspaces,
  sendForSignature,
  type ApiPrincipal,
} from '@st/core';
import { db } from './db';
import { env } from './env';
import { storage } from './storage';
import { liveSendingEnabled } from './billing';
import { sendInvitations } from './signing-mail';

type Doc = Awaited<ReturnType<typeof getDocument>>;
type Reqs = Awaited<ReturnType<typeof getRequestsForDocument>>;

export function documentOut(d: Doc, reqs: Reqs = []) {
  const doc = d.document;
  return {
    id: doc.id,
    title: doc.title,
    document_type: doc.documentType,
    status: doc.status,
    page_count: doc.pageCount,
    signing_order: doc.signingOrderEnabled,
    settings: doc.settings,
    email_message: doc.emailMessage,
    external: doc.externalSource
      ? { source: doc.externalSource, id: doc.externalId, metadata: doc.externalMetadata ?? {} }
      : null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    file: d.file
      ? { sha256: d.file.sha256, size_bytes: d.file.sizeBytes, filename: d.file.originalFilename }
      : null,
    recipients: d.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      signing_order: r.signingOrder,
      auth_method: r.authMethod,
    })),
    fields: d.fields.map((f) => ({
      id: f.id,
      recipient_id: f.recipientId,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      label: f.label,
      options: f.options,
    })),
    requests: reqs.map((r) => ({
      id: r.request.id,
      status: r.request.status,
      test: r.request.isTest,
      sent_at: r.request.sentAt,
      completed_at: r.request.completedAt,
    })),
  };
}

export const sendSchema = z.object({
  mode: z.enum(['test', 'live']).default('test'),
  /** false: no emails; the partner opens embedded signing sessions instead. */
  notify: z.boolean().default(true),
  /**
   * Confirms the document is not one that needs extra formalities (wills, notarized deeds and
   * similar; see legal.specialized_documents). Required for live sends; recorded as evidence.
   */
  acknowledge_specialized_documents: z.boolean().default(false),
});

export async function sendViaApi(
  p: ApiPrincipal,
  documentId: string,
  input: z.infer<typeof sendSchema>,
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  const d = db();
  const res = await sendForSignature(
    d,
    storage(),
    p.actor,
    documentId,
    input.mode === 'test'
      ? {
          mode: 'test',
          testSigningEnabled: await isFeatureEnabled(d, 'test_signing', env().APP_ENV),
        }
      : {
          mode: 'live',
          testSigningEnabled: false,
          liveSendingEnabled: await liveSendingEnabled(),
          specializedAck: input.acknowledge_specialized_documents ? { source: 'api' } : undefined,
        },
    meta,
  );
  if (res.status === 'sent' && input.notify && res.invitations.length) {
    const [doc, me, workspaces] = await Promise.all([
      getDocument(d, p.actor, documentId),
      getProfile(d, p.actor),
      listMyWorkspaces(d, p.actor),
    ]);
    await sendInvitations(res.invitations, {
      title: doc.document.title,
      senderName: me.name,
      workspaceName: workspaces.find((w) => w.id === p.workspaceId)?.name ?? '',
      message: doc.document.emailMessage,
      isTest: input.mode === 'test',
      workspaceId: p.workspaceId,
    });
  }
  return {
    request_id: res.requestId,
    status: res.status,
    notified: res.status === 'sent' && input.notify,
  };
}

export const uuidParam = z.string().uuid();
