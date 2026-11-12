'use server';
import { requireUser } from '@/lib/session';
import { sendEmail } from '@/lib/email';
import { emailConfig } from '@/lib/email/config';
import { PREVIEW_KEYS, renderPreview, type PreviewKey } from '@/lib/email/previews';

/** Sends the preview to the signed-in user's own address, for checking real inbox rendering. */
export async function sendTestEmailAction(
  variant: PreviewKey,
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (!PREVIEW_KEYS.includes(variant)) return { ok: false, message: 'Unknown preview.' };
  const cfg = await emailConfig();
  const r = renderPreview(variant, cfg, { linkExpiresAt: new Date(Date.now() + 30 * 86_400_000) });
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
