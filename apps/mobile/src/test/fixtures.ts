import type { BoardCardDTO, BoardData, DocumentSummary } from '@/lib/types';

export function card(over: Partial<BoardCardDTO> = {}): BoardCardDTO {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Consulting Proposal',
    reference: 'ST-11111111',
    typeLabel: 'Agreement',
    column: 'in_progress',
    statusLabel: 'In progress',
    statusTone: 'info',
    isTest: false,
    ownerLabel: 'You',
    people: [
      { name: 'Ada Lovelace', initials: 'AL', state: 'Signed' },
      { name: 'Jo Dale', initials: 'JD', state: 'Waiting' },
    ],
    recipientCount: 2,
    requiredCount: 2,
    requiredDone: 1,
    dateLabel: 'Updated Nov 12, 2026',
    dateIso: '2026-11-12T10:00:00.000Z',
    dueLabel: 'Due Nov 20, 2026',
    dueSoon: false,
    requestId: '22222222-2222-4222-8222-222222222222',
    actions: ['details', 'send_reminder'],
    urls: {
      page: '/app/documents/11111111-1111-4111-8111-111111111111',
      edit: null,
      activity: '/app/documents/11111111-1111-4111-8111-111111111111?tab=activity',
      packageDownload: null,
      signedDownload: null,
      certificateView: null,
    },
    ...over,
  };
}

export function board(cards: BoardCardDTO[], over: Partial<BoardData> = {}): BoardData {
  const counts = { drafts: 0, sent: 0, in_progress: 0, completed: 0, declined_expired: 0, cancelled: 0 };
  for (const c of cards) counts[c.column] += 1;
  return { counts, total: cards.length, cards, column: null, offset: 0, limit: 20, ...over };
}

export function summary(over: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'ST-11111111',
    title: 'Consulting Proposal',
    typeLabel: 'Agreement',
    status: 'in_progress',
    statusLabel: 'In progress',
    isTest: false,
    archived: false,
    purged: false,
    createdBy: 'Kay Board',
    createdByYou: true,
    createdAt: '2026-11-10T10:00:00.000Z',
    sentAt: '2026-11-10T10:00:00.000Z',
    completedAt: null,
    closedAt: null,
    expiresAt: '2026-11-20T10:00:00.000Z',
    pageCount: 1,
    actionableCount: 2,
    actionableDone: 1,
    recipientCount: 2,
    signingOrder: false,
    requestId: '22222222-2222-4222-8222-222222222222',
    signers: [
      {
        id: 's1', name: 'Ada Lovelace', email: 'ada@example.test', role: 'signer', roleLabel: 'Signer', order: 1,
        status: 'signed', statusLabel: 'Signed', authLabel: 'Email link', viewedAt: null,
        doneAt: '2026-11-11T10:00:00.000Z', declineReason: null, reminders: 0,
      },
      {
        id: 's2', name: 'Jo Dale', email: 'jo@example.test', role: 'signer', roleLabel: 'Signer', order: 2,
        status: 'pending', statusLabel: 'Pending', authLabel: 'Email link', viewedAt: null,
        doneAt: null, declineReason: null, reminders: 1,
      },
    ],
    activity: [
      { id: 'a1', at: '2026-11-10T10:00:00.000Z', type: 'request.sent', title: 'Sent for signature', description: null, actor: 'Kay Board', tone: 'info', icon: 'send' },
    ],
    files: [],
    evidence: {
      available: false, certificateNumber: null, verificationRef: null, eventCount: 3, consentCount: 1,
      signedCount: 1, originalSha256: null, signedSha256: null, certificateViewUrl: null, certificateDownloadUrl: null,
    },
    urls: { page: '/app/documents/11111111-1111-4111-8111-111111111111', edit: null, signedDownload: null, packageDownload: null, documentView: null },
    actions: ['view_document', 'send_reminder', 'cancel_request'],
    access: 'manage',
    ...over,
  };
}
