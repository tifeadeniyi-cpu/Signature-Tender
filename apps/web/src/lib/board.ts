import 'server-only';
import {
  loadBoard,
  hasPermission,
  documentReferenceOf,
  DOCUMENT_TYPES,
  type BoardCard,
  type BoardOptions,
  type LibraryQuery,
  type MembershipContext,
} from '@st/core';
import { db } from '@/lib/db';
import type { BoardAction, BoardCardDTO, BoardData, BoardPerson } from '@/lib/board-types';

const dayFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (d: Date) => dayFmt.format(d);

const REQ_LABEL: Record<string, [string, BoardCardDTO['statusTone']]> = {
  awaiting_payment: ['Awaiting payment', 'warning'],
  payment_processing: ['Payment processing', 'info'],
  ready_to_dispatch: ['Ready to send', 'info'],
  queued: ['Queued to send', 'info'],
  sent: ['Sent', 'info'],
  in_progress: ['In progress', 'info'],
  awaiting_approval: ['Awaiting approval', 'info'],
  finalization_failed: ['Needs attention', 'error'],
  completed: ['Completed', 'success'],
  declined: ['Declined', 'error'],
  expired: ['Expired', 'warning'],
  cancelled: ['Cancelled', 'warning'],
};
const OPEN = ['sent', 'in_progress', 'awaiting_approval'];
const CANCELLABLE = [...OPEN, 'awaiting_payment', 'ready_to_dispatch', 'queued'];

function initials(name: string, email: string) {
  const parts = (name || email)
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function personState(role: string, status: string | null, requestStatus: string | null) {
  if (role === 'cc' || role === 'viewer') return 'Gets a copy';
  if (!requestStatus) return role === 'signer' ? 'Signer' : role[0]!.toUpperCase() + role.slice(1);
  if (status === 'signed') return role === 'approver' ? 'Approved' : 'Signed';
  if (status === 'declined') return 'Declined';
  if (status === 'viewed') return 'Viewed';
  return 'Waiting';
}

/** Maps a core card to what the board shows, with actions from the document page's own rules. */
function toDTO(c: BoardCard, userId: string, canSendPerm: boolean): BoardCardDTO {
  const r = c.requestStatus;
  const canSend = c.canEdit && canSendPerm;
  const [statusLabel, statusTone] = r
    ? (REQ_LABEL[r] ?? [r, 'neutral'])
    : c.documentStatus === 'ready_to_send'
      ? (['Ready to send', 'success'] as const)
      : (['Draft', 'neutral'] as const);

  let date: Date;
  let prefix: string;
  switch (c.column) {
    case 'drafts':
      date = r && c.sentAt ? c.sentAt : c.lastActivity;
      prefix = 'Edited';
      break;
    case 'sent':
      date = c.sentAt ?? c.lastActivity;
      prefix = 'Sent';
      break;
    case 'in_progress':
      date = c.lastActivity;
      prefix = 'Updated';
      break;
    case 'completed':
      date = c.completedAt ?? c.lastActivity;
      prefix = 'Completed';
      break;
    default:
      date = c.closedAt ?? c.lastActivity;
      prefix = statusLabel;
  }
  const open = Boolean(r && OPEN.includes(r));
  const due = open && c.expiresAt ? c.expiresAt : null;
  const rid = c.requestId;
  const completed = r === 'completed';
  const urls: BoardCardDTO['urls'] = {
    page: `/app/documents/${c.id}`,
    edit:
      !r && c.canEdit
        ? `/app/documents/${c.id}/prepare`
        : canSend && r
          ? `/app/documents/${c.id}/prepare/review`
          : null,
    activity: `/app/documents/${c.id}?tab=activity`,
    packageDownload:
      completed && c.canDownload && c.hasCertificate
        ? `/api/requests/${rid}/file?kind=package`
        : null,
    signedDownload: completed && c.canDownload ? `/api/requests/${rid}/file?kind=signed` : null,
    certificateView:
      completed && c.hasCertificate ? `/api/requests/${rid}/file?kind=certificate&view=1` : null,
  };

  const a: BoardAction[] = [];
  if (c.column === 'drafts') {
    if (!r && c.canEdit) a.push('continue_editing');
    a.push('details', 'view_page');
    if (r && canSend && CANCELLABLE.includes(r)) a.push('cancel_request');
    if (!r && c.canEdit) a.push('archive');
  } else if (c.column === 'sent' || c.column === 'in_progress') {
    a.push('details', 'view_page');
    if (open && canSend && c.awaitingSomeone) a.push('send_reminder');
    a.push('view_activity');
    if (r && canSend && CANCELLABLE.includes(r)) a.push('cancel_request');
  } else if (c.column === 'completed') {
    a.push('view_completed');
    if (urls.packageDownload) a.push('download_package');
    if (urls.signedDownload) a.push('download_signed');
    if (urls.certificateView) a.push('view_certificate');
    a.push('view_audit', 'details');
    if (c.canEdit) a.push('archive');
  } else {
    a.push('details', 'view_activity');
    if (canSend && urls.edit) a.push('send_again');
    if (c.canEdit) a.push('archive');
  }

  const people: BoardPerson[] = c.recipients.map((p) => ({
    name: p.name || p.email,
    initials: initials(p.name, p.email),
    state: personState(p.role, p.status, r),
  }));

  return {
    id: c.id,
    title: c.title,
    reference: documentReferenceOf(c.id),
    typeLabel: DOCUMENT_TYPES.find((d) => d.value === c.documentType)?.label ?? 'Document',
    column: c.column,
    statusLabel,
    statusTone,
    isTest: c.isTest,
    ownerLabel: c.createdBy === userId ? 'You' : (c.ownerName ?? 'A teammate'),
    people,
    recipientCount: c.recipientCount,
    requiredCount: c.requiredCount,
    requiredDone: c.requiredDone,
    dateLabel: `${prefix} ${day(date)}`,
    dateIso: date.toISOString(),
    dueLabel: due ? `Due ${day(due)}` : null,
    dueSoon: Boolean(due && due.getTime() - Date.now() < 3 * 86_400_000),
    requestId: rid,
    actions: a,
    urls,
  };
}

/** The board for the signed-in member's current workspace. Visibility is row-level security. */
export async function getBoard(
  userId: string,
  membership: MembershipContext,
  query: LibraryQuery,
  opts: BoardOptions = {},
): Promise<BoardData> {
  const b = await loadBoard(db(), { userId }, membership.workspace.id, query, opts);
  const canSend = hasPermission(membership.permissions, 'documents.send');
  return {
    counts: b.counts,
    total: b.total,
    cards: b.cards.map((c) => toDTO(c, userId, canSend)),
    column: b.column,
    offset: b.offset,
    limit: b.limit,
  };
}
