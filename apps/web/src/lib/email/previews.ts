import type { EmailAssetName } from './assets.generated';
import type { EmailLinksConfig } from './design';
import { renderDocumentCompleted, type RenderedEmail } from './templates/document-completed';
import {
  renderCodeEmail,
  renderCompletedCopy,
  renderDeclinedNotice,
  renderPasswordReset,
  renderSigningRequest,
  renderTeamInvitation,
  renderVerifyEmail,
} from './templates/transactional';
import { samplePayload, type SampleVariant } from './samples';

/** Every email the preview page can show, with fictional data only. */
export const PREVIEWS = [
  ['recipient', 'Completed: recipient'],
  ['sender', 'Completed: sender'],
  ['no-download', 'Completed: downloads off'],
  ['test', 'Completed: test request'],
  ['invitation', 'Invitation to sign'],
  ['reminder', 'Reminder'],
  ['completed-copy', 'Completed copy link'],
  ['signing-code', 'Signing code'],
  ['retrieval-code', 'Access code'],
  ['declined', 'Declined (to sender)'],
  ['team-invite', 'Team invitation'],
  ['verify-email', 'Verify email'],
  ['password-reset', 'Password reset'],
] as const;
export type PreviewKey = (typeof PREVIEWS)[number][0];
export const PREVIEW_KEYS = PREVIEWS.map(([k]) => k) as PreviewKey[];

export function renderPreview(
  key: PreviewKey,
  config: EmailLinksConfig & { timeZone: string; appUrl: string },
  opts: { imageSrc?: (n: EmailAssetName) => string; linkExpiresAt?: Date } = {},
): RenderedEmail {
  const url = `${config.appUrl}/retrieve`;
  const base = { config, imageSrc: opts.imageSrc };
  const doc = {
    recipientName: 'Riley Recipient (sample)',
    recipientEmail: 'riley@example.com',
    title: 'Sample Consulting Agreement',
    url,
    retrieveUrl: url,
    isTest: false,
  };
  switch (key) {
    case 'invitation':
    case 'reminder':
      return renderSigningRequest({
        ...base,
        ...doc,
        senderName: 'Sam Sender (sample)',
        workspaceName: 'Sample Studio',
        message: 'Hi Riley, here is the agreement we discussed. Let me know if you have questions.',
        reminder: key === 'reminder',
      });
    case 'completed-copy':
      return renderCompletedCopy({ ...base, ...doc });
    case 'signing-code':
      return renderCodeEmail({
        ...base,
        purpose: 'signing',
        code: '482913',
        name: doc.recipientName,
        title: doc.title,
      });
    case 'retrieval-code':
      return renderCodeEmail({ ...base, purpose: 'retrieval', code: '730415', returnUrl: url });
    case 'declined':
      return renderDeclinedNotice({
        ...base,
        title: doc.title,
        recipientName: doc.recipientName,
        reason: 'The start date needs to change before I can sign.',
        url,
        isTest: false,
      });
    case 'team-invite':
      return renderTeamInvitation({
        ...base,
        workspaceName: 'Sample Studio',
        inviterName: 'Sam Sender (sample)',
        roleName: 'Member',
        expiresOn: 'Dec 9, 2026',
        url,
      });
    case 'verify-email':
      return renderVerifyEmail({ ...base, name: 'Riley Recipient (sample)', url });
    case 'password-reset':
      return renderPasswordReset({ ...base, url });
    default:
      return renderDocumentCompleted({
        payload: samplePayload(key as SampleVariant),
        audience: key === 'sender' ? 'sender' : 'recipient',
        links: { download: url, view: url, evidence: url },
        linkExpiresAt: opts.linkExpiresAt ?? new Date('2026-12-09T00:00:00Z'),
        config,
        imageSrc: opts.imageSrc,
      });
  }
}
