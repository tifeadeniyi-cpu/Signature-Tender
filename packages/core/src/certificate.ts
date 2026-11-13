import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database, Tx } from '@st/db';
import type { CertificateEvent, CertificateSigner } from './certificate-pdf';

/**
 * Turns recorded signing evidence into the rows printed on the Certificate of Completion.
 * Nothing here invents an event: each line maps one stored record, and anything not recorded is
 * left out rather than guessed.
 */

const ACTING = ['signer', 'approver', 'reviewer'];

const ROLE_LABEL: Record<string, string> = {
  signer: 'Signer',
  approver: 'Approver',
  reviewer: 'Reviewer',
};
const DONE_LABEL: Record<string, string> = {
  signer: 'Signed',
  approver: 'Approved',
  reviewer: 'Reviewed',
};
const METHOD_LABEL: Record<string, string> = {
  typed: 'Typed',
  drawn: 'Drawn',
  uploaded: 'Uploaded',
};

export interface EvidenceRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
  authMethod: string;
  authenticatedAt: Date | null;
  signedAt: Date | null;
}

export interface EvidenceSignature {
  recipientId: string;
  kind: string;
  method: string;
}

export interface EvidenceEvent {
  seq: number;
  type: string;
  recipientId: string | null;
  createdAt: Date;
}

/** One row per participant who had to act, however many fields they completed. */
export function certificateSigners(
  recipients: EvidenceRecipient[],
  signatures: EvidenceSignature[],
  eventRefOf: (recipientId: string) => string | null = () => null,
): CertificateSigner[] {
  return recipients
    .filter((r) => ACTING.includes(r.role) && r.signedAt)
    .map((r) => {
      const methods = [
        ...new Set(
          signatures
            .filter((s) => s.recipientId === r.id && s.kind === 'signature')
            .map((s) => METHOD_LABEL[s.method] ?? s.method),
        ),
      ];
      // Only verification that was completed is listed; a code that was never entered is not.
      const authLabel =
        r.authMethod === 'email_code' && r.authenticatedAt
          ? 'Email link + one-time code'
          : 'Email invitation link';
      return {
        name: r.name,
        email: r.email,
        roleLabel: ROLE_LABEL[r.role] ?? r.role,
        authLabel,
        methodLabel: r.role === 'signer' ? methods.join(', ') || '—' : '—',
        doneAt: r.signedAt!,
        statusLabel: DONE_LABEL[r.role] ?? 'Completed',
        eventRef: eventRefOf(r.id),
      };
    });
}

/**
 * The audit trail lines, in time order. Covers only events recorded up to completion. Repeat
 * views by the same person are shown once (first view); the full log stays in the evidence record.
 */
export function certificateEvents(input: {
  events: EvidenceEvent[];
  recipients: EvidenceRecipient[];
  senderName: string;
  uploadedAt: Date | null;
  completedAt: Date;
}): CertificateEvent[] {
  const name = new Map(input.recipients.map((r) => [r.id, r.name]));
  const acting = input.recipients.filter((r) => ACTING.includes(r.role)).length;
  const seenView = new Set<string>();
  const out: CertificateEvent[] = [];
  if (input.uploadedAt) out.push({ at: input.uploadedAt, text: 'Document uploaded' });
  for (const e of [...input.events].sort((a, b) => a.seq - b.seq)) {
    if (e.createdAt > input.completedAt) continue;
    const who = e.recipientId ? (name.get(e.recipientId) ?? 'A recipient') : '';
    let line: string | null = null;
    switch (e.type) {
      case 'request.created':
        line = 'Signing request created';
        break;
      case 'request.sent':
        line = `Signing request sent by ${input.senderName} to ${acting} ${acting === 1 ? 'recipient' : 'recipients'}`;
        break;
      case 'recipient.notified':
        line = `Invitation emailed to ${who}`;
        break;
      case 'recipient.reminded':
        line = `Reminder emailed to ${who}`;
        break;
      case 'recipient.link_reissued':
        line = `New signing link issued to ${who}`;
        break;
      case 'recipient.viewed':
        if (e.recipientId && seenView.has(e.recipientId)) break;
        if (e.recipientId) seenView.add(e.recipientId);
        line = `${who} opened the document`;
        break;
      case 'recipient.code_verified':
        line = `${who} entered a one-time email code`;
        break;
      case 'recipient.consented':
        line = `${who} agreed to use electronic records and signatures`;
        break;
      case 'recipient.signature_adopted':
        line = `${who} adopted a signature`;
        break;
      case 'recipient.signed':
        line = `${who} signed the document`;
        break;
      case 'recipient.approved':
        line = `${who} approved the document`;
        break;
      case 'recipient.reviewed':
        line = `${who} completed their review`;
        break;
    }
    if (line) out.push({ at: e.createdAt, text: line });
  }
  out.push({
    at: input.completedAt,
    text: 'Signing completed: all required participants finished',
    final: true,
  });
  return out;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A public, non-secret reference such as STV-7F3D-9AKQ. Not usable to open anything. */
export function newVerificationRef(): string {
  const b = randomBytes(8);
  const chars = Array.from(b, (x) => ALPHABET[x % 32]).join('');
  return `STV-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export async function nextCertificateNumber(tx: Tx, at: Date): Promise<string> {
  const [row] = (await tx.execute(
    sql`select st_next_certificate_number(${at.toISOString()}::timestamptz) as n`,
  )) as unknown as { n: string }[];
  return row!.n;
}

// ---------------------------------------------------------------------------------------------
// Public verification (no sign-in). Database functions return only non-identifying facts.

export interface PublicVerification {
  verificationRef: string;
  status: string;
  certificateNumber: string | null;
  certificateIssuedAt: Date | null;
  completedAt: Date | null;
  agreementPages: number | null;
  certificatePages: number | null;
  signerCount: number;
  isTest: boolean;
  filesAvailable: boolean;
}

export const VERIFICATION_REF = /^STV-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

export function normalizeVerificationRef(input: string): string | null {
  const v = input.trim().toUpperCase().replace(/\s+/g, '');
  return VERIFICATION_REF.test(v) ? v : null;
}

export async function verifyReference(
  db: Database,
  ref: string,
): Promise<PublicVerification | null> {
  const v = normalizeVerificationRef(ref);
  if (!v) return null;
  const rows = (await db.transaction((tx) =>
    tx.execute(sql`select * from st_verify_reference(${v})`),
  )) as unknown as Record<string, unknown>[];
  const r = rows[0];
  if (!r) return null;
  const d = (x: unknown) => (x ? new Date(x as string) : null);
  return {
    verificationRef: String(r.verification_ref),
    status: String(r.status),
    certificateNumber: (r.certificate_number as string) ?? null,
    certificateIssuedAt: d(r.certificate_issued_at),
    completedAt: d(r.completed_at),
    agreementPages: (r.agreement_pages as number) ?? null,
    certificatePages: (r.certificate_pages as number) ?? null,
    signerCount: Number(r.signer_count ?? 0),
    isTest: Boolean(r.is_test),
    filesAvailable: Boolean(r.files_available),
  };
}

export type HashMatch = 'package' | 'signed' | 'certificate' | 'original' | 'none';

/** Compares a SHA-256 (computed in the visitor's browser) with this reference's stored files. */
export async function verifyFileHash(
  db: Database,
  ref: string,
  sha256: string,
): Promise<HashMatch | null> {
  const v = normalizeVerificationRef(ref);
  if (!v || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  const rows = (await db.transaction((tx) =>
    tx.execute(sql`select st_verify_hash(${v}, ${sha256.toLowerCase()}) as m`),
  )) as unknown as { m: HashMatch | null }[];
  return rows[0]?.m ?? null;
}
