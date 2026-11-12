'use server';
import { requireUser } from '@/lib/session';
import { sendEmail } from '@/lib/email';
import { emailConfig } from '@/lib/email/config';
import { renderDocumentCompleted } from '@/lib/email/templates/document-completed';
import { SAMPLE_VARIANTS, samplePayload, type SampleVariant } from '@/lib/email/samples';

/** Sends the preview to the signed-in user's own address, for checking real inbox rendering. */
export async function sendTestEmailAction(
  variant: SampleVariant,
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (!SAMPLE_VARIANTS.includes(variant)) return { ok: false, message: 'Unknown preview.' };
  const cfg = await emailConfig();
  const sample = `${cfg.appUrl}/retrieve`;
  const r = renderDocumentCompleted({
    payload: samplePayload(variant),
    audience: variant === 'sender' ? 'sender' : 'recipient',
    links: { download: sample, view: sample, evidence: sample },
    linkExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    config: cfg,
  });
  try {
    await sendEmail({
      to: user.email,
      subject: `[PREVIEW] ${r.subject}`,
      text: `This is a preview with sample data. The buttons go to the Get your documents page.\n\n${r.text}`,
      html: r.html,
      attachments: r.attachments,
    });
    return { ok: true, message: `Preview sent to ${user.email}.` };
  } catch (err) {
    return { ok: false, message: `Could not send: ${(err as Error).message}` };
  }
}
