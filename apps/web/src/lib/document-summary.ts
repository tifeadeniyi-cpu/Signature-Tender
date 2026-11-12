import 'server-only';
import {
  AppError,
  DOCUMENT_TYPES,
  getDocument,
  getDocumentRecord,
  getRequestsForDocument,
  hasPermission,
  type ActivityItem,
  type MembershipContext,
} from '@st/core';
import { db } from '@/lib/db';
import { EVENT_LABELS } from '@/components/documents/event-labels';
import type {
  DocumentSummary,
  DrawerAction,
  DrawerActivity,
  DrawerFile,
  DrawerSigner,
  DrawerStatus,
  SignerStatus,
} from './document-summary-types';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Short, human reference for a document. Library search accepts it too. */
export const documentReference = (id: string) => `ST-${id.slice(0, 8).toUpperCase()}`;

const ROLE_LABEL: Record<string, string> = {
  signer: 'Signer',
  approver: 'Approver',
  reviewer: 'Reviewer',
  cc: 'CC recipient',
  viewer: 'Viewer',
};
const AUTH_LABEL: Record<string, string> = {
  email_link: 'Email link',
  email_code: 'Email link and one-time code',
};
const KIND_LABEL: Record<string, string> = {
  original: 'Original upload',
  signed: 'Signed document',
  certificate: 'Evidence certificate',
};
const OPEN = ['sent', 'in_progress', 'awaiting_approval'];
const CANCELLABLE = [
  ...OPEN,
  'awaiting_payment',
  'payment_processing',
  'ready_to_dispatch',
  'queued',
];
const PENDING = ['awaiting_payment', 'payment_processing', 'ready_to_dispatch', 'queued'];
const STATUS_LABEL: Record<DrawerStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  pending: 'Pending',
  draft: 'Draft',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  needs_attention: 'Needs attention',
};

function drawerStatus(requestStatus: string | null): DrawerStatus {
  if (!requestStatus) return 'draft';
  if (PENDING.includes(requestStatus)) return 'pending';
  if (OPEN.includes(requestStatus)) return 'in_progress';
  if (requestStatus === 'finalization_failed') return 'needs_attention';
  if (['completed', 'declined', 'expired', 'cancelled'].includes(requestStatus))
    return requestStatus as DrawerStatus;
  return 'in_progress';
}

function activityIcon(type: string): DrawerActivity['icon'] {
  if (type.startsWith('email.')) return 'mail';
  if (type === 'recipient.notified' || type === 'recipient.reminded') return 'mail';
  if (type === 'request.sent') return 'send';
  if (type.includes('viewed') || type === 'recipient.session_started') return 'eye';
  if (['recipient.signed', 'recipient.signature_adopted'].includes(type)) return 'pen';
  if (['recipient.approved', 'recipient.reviewed', 'request.completed'].includes(type))
    return 'check';
  if (/declined|cancelled|expired|failed|bounced/.test(type)) return 'x';
  if (type.includes('download') || type === 'recipient.retrieved') return 'download';
  if (/code_|consented|legal_hold/.test(type)) return 'shield';
  if (type.startsWith('document.') && type.endsWith('_updated')) return 'edit';
  return 'file';
}

function activityTone(type: string): DrawerActivity['tone'] {
  if (/declined|failed|bounced/.test(type)) return 'error';
  if (
    ['recipient.signed', 'recipient.approved', 'request.completed', 'email.delivered'].includes(
      type,
    )
  )
    return 'success';
  if (type.startsWith('recipient.') || type.startsWith('request.')) return 'info';
  return 'neutral';
}

function toActivity(e: ActivityItem, i: number): DrawerActivity {
  const kind = typeof e.data.kind === 'string' ? e.data.kind : null;
  let description: string | null = null;
  let actor = e.recipientName ?? e.actorName ?? 'Signature Tender';
  if (e.source === 'email') {
    actor = 'Signature Tender';
    const to = typeof e.data.to === 'string' ? e.data.to : null;
    description = [
      to ? `To ${e.recipientName ? `${e.recipientName} (${to})` : to}` : null,
      typeof e.data.error === 'string' ? e.data.error : null,
    ]
      .filter(Boolean)
      .join('. ');
  } else if (e.type.startsWith('document.file_') && kind) {
    description = KIND_LABEL[kind] ?? kind;
  } else if (e.type === 'recipient.declined' && typeof e.data.reason === 'string') {
    description = `Reason: ${e.data.reason}`;
  } else if (e.type === 'request.cancelled' && typeof e.data.reason === 'string' && e.data.reason) {
    description = `Reason: ${e.data.reason}`;
  }
  return {
    id: `${e.source}-${e.at.getTime()}-${i}`,
    at: e.at.toISOString(),
    type: e.type,
    title: EVENT_LABELS[e.type] ?? e.type,
    description: description || null,
    actor,
    tone: activityTone(e.type),
    icon: activityIcon(e.type),
  };
}

/**
 * Everything the documents drawer shows, for one document in the current workspace.
 * Visibility comes from row-level security (an invisible document is not_found), and the
 * actions list is computed from the same permission checks the document page uses.
 */
export async function loadDocumentSummary(
  userId: string,
  membership: MembershipContext,
  documentId: string,
): Promise<DocumentSummary> {
  const actor = { userId };
  const doc = await getDocument(db(), actor, documentId);
  // The drawer lists one workspace; permissions are per workspace, so never mix them.
  if (doc.document.workspaceId !== membership.workspace.id)
    throw new AppError('not_found', 'Document not found');
  const [requests, record] = await Promise.all([
    getRequestsForDocument(db(), actor, documentId),
    getDocumentRecord(db(), actor, documentId),
  ]);
  const latest = requests[0] ?? null;
  const r = latest?.request ?? null;
  const status = drawerStatus(r?.status ?? null);
  const purged = Boolean(record.retention.purgedAt);
  const canSend = doc.canEdit && hasPermission(membership.permissions, 'documents.send');
  const id = documentId;

  // Files: originals always; a signed copy and certificate once their request completed.
  const files: DrawerFile[] = record.files
    .filter((f) => {
      if (f.kind === 'original') return true;
      const req = record.requests.find(
        (q) => q.signedFileId === f.id || q.certificateFileId === f.id,
      );
      return req?.status === 'completed';
    })
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      label: `${KIND_LABEL[f.kind] ?? f.kind}${f.kind === 'original' && f.version > 1 ? ` (version ${f.version})` : ''}`,
      filename: f.originalFilename ?? `${doc.document.title}.pdf`,
      type: 'PDF',
      sizeBytes: Number(f.sizeBytes ?? 0),
      createdAt: f.createdAt.toISOString(),
      sha256: f.sha256,
      viewUrl: purged ? null : `/api/documents/${id}/versions/${f.id}?view=1`,
      downloadUrl: purged ? null : `/api/documents/${id}/versions/${f.id}`,
    }))
    .reverse();

  const recipients = latest?.recipients ?? [];
  const events = latest?.events ?? [];
  const reminders = new Map<string, number>();
  for (const e of events)
    if (e.type === 'recipient.reminded' && e.recipientId)
      reminders.set(e.recipientId, (reminders.get(e.recipientId) ?? 0) + 1);

  const signers: DrawerSigner[] = recipients.map((x) => {
    let st: SignerStatus;
    if (x.role === 'cc' || x.role === 'viewer') st = 'copy';
    else if (x.status === 'signed')
      st = x.role === 'approver' ? 'approved' : x.role === 'reviewer' ? 'reviewed' : 'signed';
    else if (x.status === 'declined') st = 'declined';
    else if (r?.status === 'expired') st = 'expired';
    else if (r?.status === 'cancelled') st = 'cancelled';
    else if (x.status === 'viewed') st = 'viewed';
    else if (x.status === 'notified') st = 'pending';
    else st = 'not_started';
    const label: Record<SignerStatus, string> = {
      signed: 'Signed',
      approved: 'Approved',
      reviewed: 'Reviewed',
      pending: 'Pending',
      viewed: 'Viewed',
      declined: 'Declined',
      not_started: 'Not started',
      expired: 'Expired',
      cancelled: 'Cancelled',
      copy: 'Gets a copy',
    };
    return {
      id: x.id,
      name: x.name,
      email: x.email,
      role: x.role,
      roleLabel: ROLE_LABEL[x.role] ?? x.role,
      order: x.signingOrder,
      status: st,
      statusLabel: label[st],
      authLabel: AUTH_LABEL[x.authMethod] ?? x.authMethod,
      viewedAt: iso(x.viewedAt),
      doneAt: iso(x.signedAt ?? x.declinedAt),
      declineReason: x.declineReason ?? null,
      reminders: reminders.get(x.id) ?? 0,
    };
  });
  const actionable = recipients.filter((x) => x.role !== 'cc' && x.role !== 'viewer');

  const signedFile = r?.signedFileId ? record.files.find((f) => f.id === r.signedFileId) : null;
  const certFile = r?.certificateFileId
    ? record.files.find((f) => f.id === r.certificateFileId)
    : null;
  const completed = r?.status === 'completed';
  const fileReady = completed && !purged;

  const actions: DrawerAction[] = ['view_document'];
  if (fileReady && signedFile) actions.unshift('download_signed');
  if (fileReady && certFile) actions.push('view_certificate', 'download_certificate');
  if (
    r &&
    canSend &&
    OPEN.includes(r.status) &&
    recipients.some((x) => x.status === 'notified' || x.status === 'viewed')
  )
    actions.push('send_reminder');
  if (r && canSend && CANCELLABLE.includes(r.status)) actions.push('cancel_request');
  if (!r && doc.canEdit) actions.push('continue_editing');
  if (r && canSend && ['declined', 'expired', 'cancelled'].includes(r.status))
    actions.push('send_again');

  return {
    id,
    reference: documentReference(id),
    title: doc.document.title,
    typeLabel:
      DOCUMENT_TYPES.find((d) => d.value === doc.document.documentType)?.label ?? 'Document',
    status,
    statusLabel:
      !r && doc.document.status === 'ready_to_send' ? 'Ready to send' : STATUS_LABEL[status],
    isTest: Boolean(r?.isTest),
    archived: Boolean(record.document.archivedAt),
    purged,
    createdBy: record.ownerName,
    createdByYou: doc.document.createdBy === userId,
    createdAt: doc.document.createdAt.toISOString(),
    sentAt: iso(r?.sentAt),
    completedAt: iso(r?.completedAt),
    closedAt: iso(r?.closedAt),
    expiresAt: iso(r?.expiresAt),
    pageCount: doc.document.pageCount ?? null,
    actionableCount: actionable.length,
    actionableDone: actionable.filter((x) => x.status === 'signed').length,
    recipientCount: recipients.length,
    signingOrder: Boolean(r?.signingOrderEnabled),
    requestId: r?.id ?? null,
    signers,
    activity: record.activity.map(toActivity).reverse(),
    files,
    evidence: {
      available: Boolean(fileReady && certFile),
      eventCount: events.length,
      consentCount: actionable.filter((x) => x.consentedAt).length,
      signedCount: actionable.filter((x) => x.status === 'signed').length,
      originalSha256: r?.sourceSha256 ?? null,
      signedSha256: signedFile?.sha256 ?? null,
      certificateViewUrl:
        fileReady && certFile ? `/api/documents/${id}/versions/${certFile.id}?view=1` : null,
      certificateDownloadUrl:
        fileReady && certFile ? `/api/requests/${r!.id}/file?kind=certificate` : null,
    },
    urls: {
      page: `/app/documents/${id}`,
      edit:
        !r && doc.canEdit
          ? `/app/documents/${id}/prepare`
          : canSend && r
            ? `/app/documents/${id}/prepare/review`
            : null,
      signedDownload: fileReady && signedFile ? `/api/requests/${r!.id}/file?kind=signed` : null,
      documentView: purged
        ? null
        : fileReady && signedFile
          ? `/api/documents/${id}/versions/${signedFile.id}?view=1`
          : (files.find((f) => f.kind === 'original')?.viewUrl ?? null),
    },
    actions,
    access: canSend || doc.canEdit ? 'manage' : 'view',
  };
}
