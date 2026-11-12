import type { CompletedPayload } from '@st/core';

/** Fictional data for previews and test sends. Never used for real notifications. */
export const SAMPLE_VARIANTS = ['recipient', 'sender', 'no-download', 'test'] as const;
export type SampleVariant = (typeof SAMPLE_VARIANTS)[number];

export const VARIANT_LABEL: Record<SampleVariant, string> = {
  recipient: 'Recipient',
  sender: 'Sender',
  'no-download': 'Recipient, downloads off',
  test: 'Test request',
};

export function samplePayload(variant: SampleVariant): CompletedPayload {
  return {
    requestId: '00000000-0000-4000-8000-000000000001',
    documentId: '00000000-0000-4000-8000-000000000002',
    documentName: 'Sample Artist Management Agreement',
    documentReference: '00000000-0000-4000-8000-000000000001',
    documentPageCount: 8,
    completedAt: '2026-11-09T22:27:00.000Z',
    completedSignerCount: 2,
    requiredSignerCount: 2,
    senderName: 'Sam Sender (sample)',
    senderEmail: 'sender@example.com',
    workspaceName: 'Sample Studio',
    recipientName: variant === 'sender' ? 'Sam Sender (sample)' : 'Riley Recipient (sample)',
    isTest: variant === 'test',
    allowDownload: variant !== 'no-download',
    signedFileId: '00000000-0000-4000-8000-000000000003',
    certificateFileId: '00000000-0000-4000-8000-000000000004',
  };
}
