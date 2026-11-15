import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, withBillingSystem, type Database, type Tx } from '@st/db';
import { AppError } from './errors';

/**
 * Give 1, Get 2 referral program.
 *
 *  - Every workspace member can have a referral link. It belongs to them *in that workspace*: the
 *    workspace is the wallet that receives their rewards, so one referral never pays two wallets.
 *  - A new person who signs up through a link (or types the code) is attributed once, for good.
 *    Existing accounts are never attributed: attribution happens only when an account is created.
 *  - Once their email is verified and they own a workspace, they get the welcome credit there.
 *  - When their first paid send settles (Stripe confirmed), the referrer gets the reward, after an
 *    optional settlement hold. Risky cases are held for staff review instead of being paid.
 *  - Rewards are credit-ledger entries in the `referral` bucket with unique idempotency keys, so a
 *    repeated webhook or two jobs at once can never pay twice. Refunds and chargebacks take back
 *    what is still unused and never push a balance below zero.
 *
 * All writes run in the billing system context, after this module has checked the actor.
 */

// ---------------------------------------------------------------------------------------------
// Program and settings

export const referralSettingsSchema = z.object({
  signupRewardEnabled: z.boolean().default(true),
  referrerRewardEnabled: z.boolean().default(true),
  /** Hold rewards with risk signals for staff review instead of paying them. */
  fraudReviewEnabled: z.boolean().default(true),
  /** More referred sign-ups than this through one link in 24 hours are flagged. */
  velocityPerDay: z.number().int().min(1).max(1000).default(10),
  /** Extra throwaway-mail domains to flag, on top of the built-in list. */
  extraDisposableDomains: z.array(z.string().trim().toLowerCase().max(253)).max(500).default([]),
  shareMessage: z
    .string()
    .trim()
    .max(400)
    .default(
      'Try Signature Tender for electronic document signing. Sign up using my referral link and get 1 free document-signing credit. I’ll earn 2 credits when you make your first qualifying purchase.',
    ),
  landingMessage: z
    .string()
    .trim()
    .max(300)
    .default('Create your account and receive 1 free document-signing credit.'),
  termsUrl: z.string().trim().max(300).default('/referral-terms'),
});
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;

export interface ReferralProgram {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'ended';
  /** Active and inside its start/end dates. */
  live: boolean;
  referrerCredits: number;
  referredCredits: number;
  attributionWindowDays: number;
  qualificationDelayHours: number;
  startAt: Date | null;
  endAt: Date | null;
  settings: ReferralSettings;
}

export const STANDARD_PROGRAM_KEY = 'standard';
/** Signed browser cookie that carries a referral code from /r/CODE to sign-up. */
export const REFERRAL_COOKIE = 'st_ref';

function toProgram(row: typeof schema.referralPrograms.$inferSelect): ReferralProgram {
  const now = Date.now();
  const inDates =
    (!row.startAt || row.startAt.getTime() <= now) && (!row.endAt || row.endAt.getTime() > now);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    live: row.status === 'active' && inDates,
    referrerCredits: row.referrerCredits,
    referredCredits: row.referredCredits,
    attributionWindowDays: row.attributionWindowDays,
    qualificationDelayHours: row.qualificationDelayHours,
    startAt: row.startAt,
    endAt: row.endAt,
    settings: referralSettingsSchema.parse(row.settings ?? {}),
  };
}

async function programRow(tx: Tx) {
  const [row] = await tx
    .select()
    .from(schema.referralPrograms)
    .where(eq(schema.referralPrograms.key, STANDARD_PROGRAM_KEY));
  if (!row) throw new Error('The standard referral program is missing (migration 0029).');
  return row;
}

/** The standard Give 1, Get 2 program. Its terms are public. */
export async function getReferralProgram(db: Database): Promise<ReferralProgram> {
  return withBillingSystem(db, async (tx) => toProgram(await programRow(tx)));
}

// ---------------------------------------------------------------------------------------------
// Codes

/** No 0/O or 1/I, so a code read aloud or typed from a screenshot cannot be misread. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** 8 characters from 32 symbols: about a trillion codes, so guessing one is impractical. */
export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/** Upper-cases and strips spaces and dashes. Returns null when it cannot be a code. */
export function normalizeReferralCode(input: string | null | undefined): string | null {
  const code = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return /^[A-Z2-9]{8,12}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------------------------------
// Risk signals

const DISPOSABLE = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'throwawaymail.com',
  'fakeinbox.com',
  'mintemail.com',
  'mohmal.com',
  'emailondeck.com',
  'tempail.com',
  'burnermail.io',
  'spamgourmet.com',
]);

/** The mailbox an address really delivers to: lower case, no +tag, no dots for Gmail. */
export function canonicalEmail(email: string): string {
  const [rawLocal = '', rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal.split('+')[0]!;
  let domain = rawDomain;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/**
 * Whether risk signals justify holding a reward for review. A shared network on its own is
 * only recorded (households and offices share one), never a reason to hold.
 */
export function needsReview(flags: readonly string[]): boolean {
  const strong = flags.filter((f) => f !== 'shared_network');
  return strong.length > 0;
}

export type ReferralRejection =
  | 'invalid'
  | 'revoked'
  | 'program_off'
  | 'self_referral'
  | 'existing_customer'
  | 'already_referred';

export const REJECTION_MESSAGES: Record<ReferralRejection, string> = {
  invalid: 'That referral code is not valid. Check it and try again.',
  revoked: 'That referral code is no longer active.',
  program_off: 'Referral rewards are not available right now.',
  self_referral: 'You cannot use your own referral code.',
  existing_customer: 'This offer is available to new Signature Tender customers.',
  already_referred: 'This account already has a referral.',
};

// ---------------------------------------------------------------------------------------------
// Events

async function logEvent(
  tx: Tx,
  e: {
    attributionId?: string | null;
    identityId?: string | null;
    type: string;
    actorType: 'system' | 'user' | 'admin';
    actorUserId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  await tx.insert(schema.referralEvents).values({
    attributionId: e.attributionId ?? null,
    identityId: e.identityId ?? null,
    type: e.type,
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    data: e.data ?? {},
  });
}

/** Serializes credit movements per workspace (the same lock billing uses). */
async function lockCredits(tx: Tx, workspaceId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'credits:' + workspaceId}, 0))`,
  );
}

async function referralBalance(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = (await tx.execute(sql`
    select coalesce(sum(delta), 0)::int as n from credit_ledger
    where workspace_id = ${workspaceId}::uuid and bucket = 'referral'`)) as unknown as {
    n: number;
  }[];
  return Math.max(0, row?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Notices: what the web layer should email once a change commits

export type ReferralNotice =
  | { kind: 'referral_joined'; to: string; name: string; referrerCredits: number }
  | { kind: 'welcome_credit'; to: string; name: string; credits: number }
  | { kind: 'reward_earned'; to: string; name: string; credits: number }
  | { kind: 'reward_adjusted'; to: string; name: string };

async function userContact(tx: Tx, userId: string) {
  const [u] = await tx
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return u ?? null;
}

// ---------------------------------------------------------------------------------------------
// Referral links

export interface MyReferralLink {
  code: string;
  status: 'active' | 'revoked';
}

/**
 * The signed-in person's referral link in this workspace, created on first use. Needs a verified
 * email and an active membership; the link's rewards go to this workspace.
 */
export async function ensureReferralLink(
  db: Database,
  actor: { userId: string },
  workspaceId: string,
): Promise<MyReferralLink> {
  if (!z.string().uuid().safeParse(workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const ok = await withActor(db, actor, async (tx) => {
    const [m] = (await tx.execute(
      sql`select st_is_member(${workspaceId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    const [u] = await tx
      .select({ verified: schema.user.emailVerified })
      .from(schema.user)
      .where(eq(schema.user.id, actor.userId));
    return Boolean(m?.ok) && Boolean(u?.verified);
  });
  if (!ok) throw new AppError('forbidden', 'Verify your email to get a referral link.');
  return withBillingSystem(db, async (tx) => {
    const find = async () =>
      (
        await tx
          .select()
          .from(schema.referralIdentities)
          .where(
            and(
              eq(schema.referralIdentities.ownerUserId, actor.userId),
              eq(schema.referralIdentities.workspaceId, workspaceId),
            ),
          )
      )[0];
    const existing = await find();
    if (existing) return { code: existing.code, status: existing.status };
    for (let i = 0; i < 5; i++) {
      const [row] = await tx
        .insert(schema.referralIdentities)
        .values({ ownerUserId: actor.userId, workspaceId, code: generateReferralCode() })
        .onConflictDoNothing()
        .returning();
      if (row) {
        await logEvent(tx, {
          identityId: row.id,
          type: 'link.created',
          actorType: 'user',
          actorUserId: actor.userId,
        });
        return { code: row.code, status: row.status };
      }
      const again = await find();
      if (again) return { code: again.code, status: again.status };
    }
    throw new Error('Could not generate a unique referral code');
  });
}

export type CodeCheck =
  | { ok: true; code: string; referredCredits: number; referrerCredits: number }
  | { ok: false; reason: ReferralRejection; message: string };

const reject = (reason: ReferralRejection): CodeCheck => ({
  ok: false,
  reason,
  message: REJECTION_MESSAGES[reason],
});

/**
 * Checks a code for the public invite page and the sign-up form. Says only whether it can be
 * used, never whose it is. `email` (when known) catches someone typing their own code.
 */
export async function checkReferralCode(
  db: Database,
  input: string | null | undefined,
  opts: { email?: string | null } = {},
): Promise<CodeCheck> {
  const code = normalizeReferralCode(input);
  if (!code) return reject('invalid');
  return withBillingSystem(db, async (tx) => {
    const program = toProgram(await programRow(tx));
    if (!program.live) return reject('program_off');
    const [row] = await tx
      .select({
        status: schema.referralIdentities.status,
        ownerEmail: schema.user.email,
      })
      .from(schema.referralIdentities)
      .innerJoin(schema.user, eq(schema.user.id, schema.referralIdentities.ownerUserId))
      .where(eq(schema.referralIdentities.code, code));
    if (!row) return reject('invalid');
    if (row.status !== 'active') return reject('revoked');
    if (opts.email) {
      if (canonicalEmail(opts.email) === canonicalEmail(row.ownerEmail))
        return reject('self_referral');
      const [taken] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.email}) = ${opts.email.trim().toLowerCase()}`);
      if (taken) return reject('existing_customer');
    }
    return {
      ok: true,
      code,
      referredCredits: program.referredCredits,
      referrerCredits: program.referrerCredits,
    };
  });
}

/** Counts one visit to /r/CODE for the funnel. Nothing about the visitor is stored. */
export async function recordReferralVisit(db: Database, input: string): Promise<boolean> {
  const code = normalizeReferralCode(input);
  if (!code) return false;
  return withBillingSystem(db, async (tx) => {
    const [row] = await tx
      .select({ id: schema.referralIdentities.id })
      .from(schema.referralIdentities)
      .where(
        and(
          eq(schema.referralIdentities.code, code),
          eq(schema.referralIdentities.status, 'active'),
        ),
      );
    if (!row) return false;
    await tx.execute(sql`
      insert into referral_visits (identity_id, day, visits) values (${row.id}::uuid, current_date, 1)
      on conflict (identity_id, day) do update set visits = referral_visits.visits + 1`);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Attribution, verification and the welcome credit

/**
 * Called once, when a new account is created. Records who referred them (if the code is still
 * usable), with risk signals. Never pays anything by itself. Safe to call twice.
 */
export async function attributeNewAccount(
  db: Database,
  f: {
    userId: string;
    email: string;
    emailVerified: boolean;
    code: string | null | undefined;
    source: 'link' | 'code';
    ipAddress?: string | null;
  },
): Promise<{ attributed: boolean; reason?: ReferralRejection; notices: ReferralNotice[] }> {
  const code = normalizeReferralCode(f.code);
  if (!code) return { attributed: false, reason: 'invalid', notices: [] };
  type Out = { attributed: boolean; reason?: ReferralRejection; notices: ReferralNotice[] };
  const result = await withBillingSystem(db, async (tx): Promise<Out> => {
    const program = toProgram(await programRow(tx));
    if (!program.live) return { attributed: false, reason: 'program_off' as const, notices: [] };
    const [identity] = await tx
      .select()
      .from(schema.referralIdentities)
      .where(eq(schema.referralIdentities.code, code));
    if (!identity) return { attributed: false, reason: 'invalid' as const, notices: [] };
    if (identity.status !== 'active')
      return { attributed: false, reason: 'revoked' as const, notices: [] };
    const owner = await userContact(tx, identity.ownerUserId);
    if (!owner || identity.ownerUserId === f.userId)
      return { attributed: false, reason: 'self_referral' as const, notices: [] };

    const flags: string[] = [];
    let status: (typeof schema.referralStatus.enumValues)[number] = f.emailVerified
      ? 'verified'
      : 'verification_pending';
    let reason: string | null = null;
    if (canonicalEmail(owner.email) === canonicalEmail(f.email)) {
      status = 'rejected';
      reason = 'Self-referral: same mailbox as the referrer.';
      flags.push('same_mailbox');
    }
    const domain = f.email.split('@')[1]?.toLowerCase() ?? '';
    if (DISPOSABLE.has(domain) || program.settings.extraDisposableDomains.includes(domain))
      flags.push('disposable_email');
    const [{ n: recent } = { n: 0 }] = (await tx.execute(sql`
      select count(*)::int as n from referral_attributions
      where identity_id = ${identity.id}::uuid and created_at > now() - interval '24 hours'`)) as unknown as {
      n: number;
    }[];
    if (recent >= program.settings.velocityPerDay) flags.push('velocity');
    if (f.ipAddress) {
      const [shared] = (await tx.execute(sql`
        select 1 as x from session
        where user_id = ${identity.ownerUserId} and ip_address = ${f.ipAddress}
          and created_at > now() - interval '30 days' limit 1`)) as unknown as { x: number }[];
      // A supporting signal only: households and offices share networks.
      if (shared) flags.push('shared_network');
    }

    const [row] = await tx
      .insert(schema.referralAttributions)
      .values({
        identityId: identity.id,
        programId: program.id,
        referredUserId: f.userId,
        source: f.source,
        status,
        verifiedAt: f.emailVerified ? new Date() : null,
        riskFlags: flags,
        reason,
      })
      .onConflictDoNothing({ target: schema.referralAttributions.referredUserId })
      .returning();
    if (!row) return { attributed: false, reason: 'already_referred' as const, notices: [] };
    await logEvent(tx, {
      attributionId: row.id,
      identityId: identity.id,
      type: status === 'rejected' ? 'referral.rejected' : 'referral.registered',
      actorType: 'system',
      data: { source: f.source, flags, ...(reason ? { reason } : {}) },
    });
    if (status === 'rejected')
      return { attributed: false, reason: 'self_referral' as const, notices: [] };
    const notices: ReferralNotice[] = [
      {
        kind: 'referral_joined',
        to: owner.email,
        name: owner.name,
        referrerCredits: program.referrerCredits,
      },
    ];
    return { attributed: true, notices };
  });
  if (result.attributed && f.emailVerified) {
    const more = await grantWelcomeCredit(db, f.userId);
    result.notices.push(...more);
  }
  return result;
}

/** The referred person verified their email. Pays the welcome credit if they own a workspace. */
export async function markReferralVerified(
  db: Database,
  userId: string,
): Promise<ReferralNotice[]> {
  await withBillingSystem(db, async (tx) => {
    const rows = await tx
      .update(schema.referralAttributions)
      .set({ status: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.referralAttributions.referredUserId, userId),
          eq(schema.referralAttributions.status, 'verification_pending'),
        ),
      )
      .returning({ id: schema.referralAttributions.id });
    for (const r of rows)
      await logEvent(tx, { attributionId: r.id, type: 'referral.verified', actorType: 'system' });
  });
  return grantWelcomeCredit(db, userId);
}

/**
 * Pays the referred person's welcome credit into the first workspace they created, once their
 * email is verified. Held for review when the referral carries risk signals. Idempotent: the
 * ledger key and the reward's unique (attribution, kind) make a second call a no-op.
 */
export async function grantWelcomeCredit(db: Database, userId: string): Promise<ReferralNotice[]> {
  return withBillingSystem(db, async (tx) => {
    const [att] = await tx
      .select()
      .from(schema.referralAttributions)
      .where(eq(schema.referralAttributions.referredUserId, userId))
      .for('update');
    if (!att) return [];
    if (att.status === 'verification_pending') {
      // Some verification paths (social sign-in, auto sign-in after verifying) skip the
      // verification hook, so the account's own verified flag is the source of truth.
      const [u] = await tx
        .select({ verified: schema.user.emailVerified })
        .from(schema.user)
        .where(eq(schema.user.id, userId));
      if (!u?.verified) return [];
      await tx
        .update(schema.referralAttributions)
        .set({ status: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.referralAttributions.id, att.id));
      await logEvent(tx, { attributionId: att.id, type: 'referral.verified', actorType: 'system' });
      att.status = 'verified';
      att.verifiedAt = new Date();
    }
    if (att.status !== 'verified') return [];
    const program = toProgram(await programRow(tx));
    const flags = (att.riskFlags as string[]) ?? [];
    if (program.settings.fraudReviewEnabled && needsReview(flags)) {
      await tx
        .update(schema.referralAttributions)
        .set({ status: 'under_review', reason: 'Held for review before the welcome credit.' })
        .where(eq(schema.referralAttributions.id, att.id));
      await logEvent(tx, {
        attributionId: att.id,
        type: 'referral.held',
        actorType: 'system',
        data: { stage: 'welcome', flags },
      });
      return [];
    }
    return payWelcome(tx, att, program, 'system', null);
  });
}

async function payWelcome(
  tx: Tx,
  att: typeof schema.referralAttributions.$inferSelect,
  program: ReferralProgram,
  actorType: 'system' | 'admin',
  actorUserId: string | null,
): Promise<ReferralNotice[]> {
  const toAwaiting = async (note: string) => {
    await tx
      .update(schema.referralAttributions)
      .set({ status: 'awaiting_purchase', updatedAt: new Date() })
      .where(eq(schema.referralAttributions.id, att.id));
    await logEvent(tx, {
      attributionId: att.id,
      type: 'referral.awaiting_purchase',
      actorType,
      actorUserId,
      data: { note },
    });
  };
  if (!program.settings.signupRewardEnabled || program.referredCredits <= 0) {
    await toAwaiting('Welcome credit switched off');
    return [];
  }
  const [ws] = (await tx.execute(
    sql`select st_referral_first_workspace(${att.referredUserId}) as id`,
  )) as unknown as { id: string | null }[];
  // No workspace yet: paid when they create one (onboarding calls grantWelcomeCredit again).
  if (!ws?.id) return [];
  await lockCredits(tx, ws.id);
  const [entry] = await tx
    .insert(schema.creditLedger)
    .values({
      workspaceId: ws.id,
      entryType: 'referral_welcome',
      bucket: 'referral',
      delta: program.referredCredits,
      idempotencyKey: `referral_welcome:${att.id}`,
      note: 'Give 1, Get 2: welcome credit',
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
    .returning({ id: schema.creditLedger.id });
  if (entry) {
    await tx.insert(schema.referralRewards).values({
      attributionId: att.id,
      kind: 'welcome',
      workspaceId: ws.id,
      credits: program.referredCredits,
      ledgerEntryId: entry.id,
    });
    await tx
      .update(schema.referralAttributions)
      .set({ referredWorkspaceId: ws.id })
      .where(eq(schema.referralAttributions.id, att.id));
    await logEvent(tx, {
      attributionId: att.id,
      type: 'reward.welcome_issued',
      actorType,
      actorUserId,
      data: { credits: program.referredCredits, workspaceId: ws.id },
    });
  }
  await toAwaiting('Welcome credit issued');
  const u = await userContact(tx, att.referredUserId);
  return entry && u
    ? [{ kind: 'welcome_credit', to: u.email, name: u.name, credits: program.referredCredits }]
    : [];
}

/** Whether this person was referred and has a welcome credit waiting or paid (for the UI). */
export async function getMyWelcomeCredit(
  db: Database,
  userId: string,
): Promise<{ credits: number; workspaceId: string } | null> {
  return withBillingSystem(db, async (tx) => {
    const [row] = await tx
      .select({ credits: schema.referralRewards.credits, ws: schema.referralRewards.workspaceId })
      .from(schema.referralRewards)
      .innerJoin(
        schema.referralAttributions,
        eq(schema.referralAttributions.id, schema.referralRewards.attributionId),
      )
      .where(
        and(
          eq(schema.referralAttributions.referredUserId, userId),
          eq(schema.referralRewards.kind, 'welcome'),
          eq(schema.referralRewards.status, 'issued'),
        ),
      );
    return row ? { credits: row.credits, workspaceId: row.ws } : null;
  });
}

// ---------------------------------------------------------------------------------------------
// Qualification and the referrer reward

/**
 * A payment settled (Stripe confirmed it). If it is the referred person's first paid send, the
 * referral qualifies: the referrer is paid now, after the settlement hold, or after review.
 * Only signing-request payments count (including Sign it yourself); credit packs, plans and
 * Signature Studio do not. Idempotent.
 */
export async function qualifyReferralPayment(
  db: Database,
  paymentId: string,
): Promise<ReferralNotice[]> {
  return withBillingSystem(db, async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (!p || p.kind !== 'request' || p.status !== 'paid' || p.amountCents <= 0 || !p.dispatchAs)
      return [];
    const [att] = await tx
      .select()
      .from(schema.referralAttributions)
      .where(eq(schema.referralAttributions.referredUserId, p.dispatchAs))
      .for('update');
    if (!att || !['verified', 'awaiting_purchase'].includes(att.status)) return [];
    if (att.qualificationPaymentId) return [];
    const program = toProgram(await programRow(tx));
    const rewardAfter = new Date(Date.now() + program.qualificationDelayHours * 3600_000);
    const flags = (att.riskFlags as string[]) ?? [];
    const hold = program.settings.fraudReviewEnabled && needsReview(flags);
    await tx
      .update(schema.referralAttributions)
      .set({
        qualificationPaymentId: p.id,
        qualifiedAt: new Date(),
        rewardAfter,
        status: hold ? 'under_review' : att.status,
        reason: hold ? 'Held for review before the referrer reward.' : att.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.referralAttributions.id, att.id));
    await logEvent(tx, {
      attributionId: att.id,
      type: hold ? 'referral.held' : 'referral.qualified',
      actorType: 'system',
      data: { paymentId: p.id, rewardAfter: rewardAfter.toISOString(), flags },
    });
    if (hold || program.qualificationDelayHours > 0) return [];
    return payReferrer(tx, att.id, program, 'system', null);
  });
}

async function payReferrer(
  tx: Tx,
  attributionId: string,
  program: ReferralProgram,
  actorType: 'system' | 'admin',
  actorUserId: string | null,
): Promise<ReferralNotice[]> {
  const [att] = await tx
    .select()
    .from(schema.referralAttributions)
    .where(eq(schema.referralAttributions.id, attributionId))
    .for('update');
  if (
    !att ||
    !att.qualificationPaymentId ||
    ['rewarded', 'rejected', 'reversed'].includes(att.status)
  )
    return [];
  const [identity] = await tx
    .select()
    .from(schema.referralIdentities)
    .where(eq(schema.referralIdentities.id, att.identityId));
  if (!identity) return [];
  const finish = async (status: 'rewarded' | 'rejected', reason: string | null) => {
    await tx
      .update(schema.referralAttributions)
      .set({ status, reason, updatedAt: new Date() })
      .where(eq(schema.referralAttributions.id, att.id));
  };
  if (identity.status !== 'active') {
    await finish('rejected', 'The referral code was revoked.');
    await logEvent(tx, {
      attributionId: att.id,
      type: 'referral.rejected',
      actorType,
      actorUserId,
      data: { reason: 'code_revoked' },
    });
    return [];
  }
  // The qualifying payment must still be paid (not refunded or disputed in the meantime).
  const [p] = await tx
    .select({ status: schema.payments.status })
    .from(schema.payments)
    .where(eq(schema.payments.id, att.qualificationPaymentId));
  if (p?.status !== 'paid') {
    await tx
      .update(schema.referralAttributions)
      .set({
        status: 'awaiting_purchase',
        qualificationPaymentId: null,
        qualifiedAt: null,
        rewardAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.referralAttributions.id, att.id));
    await logEvent(tx, {
      attributionId: att.id,
      type: 'referral.qualification_cleared',
      actorType,
      actorUserId,
      data: { paymentStatus: p?.status ?? null },
    });
    return [];
  }
  if (!program.settings.referrerRewardEnabled || program.referrerCredits <= 0) {
    await finish('rewarded', 'Referrer reward switched off when it qualified.');
    return [];
  }
  await lockCredits(tx, identity.workspaceId);
  const [entry] = await tx
    .insert(schema.creditLedger)
    .values({
      workspaceId: identity.workspaceId,
      entryType: 'referral_reward',
      bucket: 'referral',
      delta: program.referrerCredits,
      idempotencyKey: `referral_reward:${att.id}`,
      note: 'Give 1, Get 2: referral reward',
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
    .returning({ id: schema.creditLedger.id });
  if (entry) {
    await tx.insert(schema.referralRewards).values({
      attributionId: att.id,
      kind: 'referrer',
      workspaceId: identity.workspaceId,
      credits: program.referrerCredits,
      ledgerEntryId: entry.id,
    });
    await logEvent(tx, {
      attributionId: att.id,
      identityId: identity.id,
      type: 'reward.referrer_issued',
      actorType,
      actorUserId,
      data: { credits: program.referrerCredits, workspaceId: identity.workspaceId },
    });
  }
  await finish('rewarded', null);
  const u = await userContact(tx, identity.ownerUserId);
  return entry && u
    ? [{ kind: 'reward_earned', to: u.email, name: u.name, credits: program.referrerCredits }]
    : [];
}

/** Pays referrer rewards whose settlement hold has passed (the daily job). */
export async function releaseDueReferralRewards(db: Database): Promise<ReferralNotice[]> {
  const due = await withBillingSystem(db, async (tx) =>
    tx
      .select({ id: schema.referralAttributions.id })
      .from(schema.referralAttributions)
      .where(
        and(
          inArray(schema.referralAttributions.status, ['verified', 'awaiting_purchase']),
          sql`${schema.referralAttributions.qualificationPaymentId} is not null`,
          sql`${schema.referralAttributions.rewardAfter} <= now()`,
        ),
      )
      .limit(500),
  );
  const notices: ReferralNotice[] = [];
  for (const d of due) {
    notices.push(
      ...(await withBillingSystem(db, async (tx) =>
        payReferrer(tx, d.id, toProgram(await programRow(tx)), 'system', null),
      )),
    );
  }
  return notices;
}

/**
 * The qualifying payment was refunded in full or disputed. Takes back the referrer's reward
 * credits that are still unused (never more, so no balance goes negative) and records what could
 * not be recovered for staff. Runs inside the billing reversal's transaction.
 */
export async function reverseReferralForPayment(
  tx: Tx,
  paymentId: string,
  why: 'refund' | 'dispute',
): Promise<ReferralNotice[]> {
  const [att] = await tx
    .select()
    .from(schema.referralAttributions)
    .where(eq(schema.referralAttributions.qualificationPaymentId, paymentId))
    .for('update');
  if (!att) return [];
  if (att.status !== 'rewarded') {
    if (['rejected', 'reversed'].includes(att.status)) return [];
    // Not paid yet: the payment no longer qualifies, so wait for a real one.
    await tx
      .update(schema.referralAttributions)
      .set({
        status: 'awaiting_purchase',
        qualificationPaymentId: null,
        qualifiedAt: null,
        rewardAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.referralAttributions.id, att.id));
    await logEvent(tx, {
      attributionId: att.id,
      type: 'referral.qualification_cleared',
      actorType: 'system',
      data: { paymentId, why },
    });
    return [];
  }
  const [reward] = await tx
    .select()
    .from(schema.referralRewards)
    .where(
      and(
        eq(schema.referralRewards.attributionId, att.id),
        eq(schema.referralRewards.kind, 'referrer'),
      ),
    )
    .for('update');
  let taken = 0;
  if (reward && reward.status === 'issued') {
    await lockCredits(tx, reward.workspaceId);
    taken = Math.min(reward.credits, await referralBalance(tx, reward.workspaceId));
    if (taken > 0)
      await tx
        .insert(schema.creditLedger)
        .values({
          workspaceId: reward.workspaceId,
          entryType: 'referral_reversal',
          bucket: 'referral',
          delta: -taken,
          paymentId,
          idempotencyKey: `referral_reversal:${reward.id}`,
          note: `Give 1, Get 2: reward reversed (${why})`,
        })
        .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey });
    await tx
      .update(schema.referralRewards)
      .set({
        status: 'reversed',
        reversedAt: new Date(),
        reversedCredits: taken,
        reversalReason: `Qualifying payment ${why === 'refund' ? 'refunded' : 'disputed'}`,
      })
      .where(eq(schema.referralRewards.id, reward.id));
  }
  const unrecovered = reward ? reward.credits - taken : 0;
  await tx
    .update(schema.referralAttributions)
    .set({
      status: 'reversed',
      reason:
        unrecovered > 0
          ? `Qualifying payment ${why}. ${unrecovered} credit(s) were already used and need review.`
          : `Qualifying payment ${why}.`,
      riskFlags:
        unrecovered > 0
          ? sql`${schema.referralAttributions.riskFlags} || '["reward_already_used"]'::jsonb`
          : schema.referralAttributions.riskFlags,
      updatedAt: new Date(),
    })
    .where(eq(schema.referralAttributions.id, att.id));
  await logEvent(tx, {
    attributionId: att.id,
    type: 'reward.reversed',
    actorType: 'system',
    data: { paymentId, why, taken, unrecovered },
  });
  if (!reward) return [];
  const [identity] = await tx
    .select({ owner: schema.referralIdentities.ownerUserId })
    .from(schema.referralIdentities)
    .where(eq(schema.referralIdentities.id, att.identityId));
  const u = identity ? await userContact(tx, identity.owner) : null;
  return u ? [{ kind: 'reward_adjusted', to: u.email, name: u.name }] : [];
}

// ---------------------------------------------------------------------------------------------
// The Refer & Earn page

export type ReferralHistoryStatus =
  | 'pending_verification'
  | 'awaiting_purchase'
  | 'under_review'
  | 'rewarded'
  | 'ineligible'
  | 'reversed';

export interface ReferralHistoryRow {
  id: string;
  /** "Jane D." — never the full name or email. */
  displayName: string;
  joinedAt: Date;
  status: ReferralHistoryStatus;
  /** 1 Friend registered, 2 verified, 3 qualifying purchase, 4 you were rewarded. */
  step: 1 | 2 | 3 | 4;
  rewardCredits: number;
  rewardedAt: Date | null;
}

export interface ReferralActivityRow {
  id: string;
  at: Date;
  type: 'welcome' | 'reward' | 'reversal' | 'adjustment' | 'used' | 'returned';
  delta: number;
  balanceAfter: number;
  note: string | null;
}

export interface ReferralCenter {
  program: Pick<
    ReferralProgram,
    'name' | 'live' | 'referrerCredits' | 'referredCredits' | 'settings'
  >;
  link: MyReferralLink | null;
  summary: { successful: number; pending: number; earned: number; available: number };
  history: ReferralHistoryRow[];
  activity: ReferralActivityRow[];
  /** Can this person see the workspace's credit balance (send or billing permission)? */
  canSeeBalance: boolean;
}

export function maskName(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'New customer';
  const first = parts[0]!.slice(0, 40);
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` : '';
  return first + last;
}

function historyStatus(s: string): ReferralHistoryStatus {
  switch (s) {
    case 'verification_pending':
      return 'pending_verification';
    case 'verified':
    case 'awaiting_purchase':
      return 'awaiting_purchase';
    case 'under_review':
      return 'under_review';
    case 'rewarded':
      return 'rewarded';
    case 'reversed':
      return 'reversed';
    default:
      return 'ineligible';
  }
}

export async function getReferralCenter(
  db: Database,
  actor: { userId: string },
  workspaceId: string,
): Promise<ReferralCenter> {
  if (!z.string().uuid().safeParse(workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const canSeeBalance = await withActor(db, actor, async (tx) => {
    const [m] = (await tx.execute(sql`
      select st_is_member(${workspaceId}::uuid) as member,
             st_can_view_balance(${workspaceId}::uuid) as balance`)) as unknown as {
      member: boolean;
      balance: boolean;
    }[];
    if (!m?.member) throw new AppError('not_found', 'Workspace not found');
    return Boolean(m.balance);
  });
  return withBillingSystem(db, async (tx) => {
    const program = toProgram(await programRow(tx));
    const [identity] = await tx
      .select()
      .from(schema.referralIdentities)
      .where(
        and(
          eq(schema.referralIdentities.ownerUserId, actor.userId),
          eq(schema.referralIdentities.workspaceId, workspaceId),
        ),
      );
    let history: ReferralHistoryRow[] = [];
    if (identity) {
      const rows = await tx
        .select({
          id: schema.referralAttributions.id,
          name: schema.user.name,
          joinedAt: schema.referralAttributions.registeredAt,
          status: schema.referralAttributions.status,
          qualifiedAt: schema.referralAttributions.qualifiedAt,
          verifiedAt: schema.referralAttributions.verifiedAt,
          rewardCredits: schema.referralRewards.credits,
          rewardStatus: schema.referralRewards.status,
          rewardedAt: schema.referralRewards.issuedAt,
        })
        .from(schema.referralAttributions)
        .innerJoin(schema.user, eq(schema.user.id, schema.referralAttributions.referredUserId))
        .leftJoin(
          schema.referralRewards,
          and(
            eq(schema.referralRewards.attributionId, schema.referralAttributions.id),
            eq(schema.referralRewards.kind, 'referrer'),
          ),
        )
        .where(eq(schema.referralAttributions.identityId, identity.id))
        .orderBy(desc(schema.referralAttributions.registeredAt))
        .limit(500);
      history = rows.map((r) => {
        const status = historyStatus(r.status);
        const step: ReferralHistoryRow['step'] =
          status === 'rewarded' ? 4 : r.qualifiedAt ? 3 : r.verifiedAt ? 2 : 1;
        return {
          id: r.id,
          displayName: maskName(r.name),
          joinedAt: r.joinedAt,
          status,
          step,
          rewardCredits: r.rewardStatus === 'issued' ? (r.rewardCredits ?? 0) : 0,
          rewardedAt: r.rewardStatus === 'issued' ? r.rewardedAt : null,
        };
      });
    }
    const earned = history.reduce((n, h) => n + h.rewardCredits, 0);
    const successful = history.filter((h) => h.status === 'rewarded').length;
    const pending = history.filter((h) =>
      ['pending_verification', 'awaiting_purchase', 'under_review'].includes(h.status),
    ).length;

    let activity: ReferralActivityRow[] = [];
    let available = 0;
    if (canSeeBalance) {
      const entries = await tx
        .select({
          id: schema.creditLedger.id,
          at: schema.creditLedger.createdAt,
          type: schema.creditLedger.entryType,
          delta: schema.creditLedger.delta,
          note: schema.creditLedger.note,
        })
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.workspaceId, workspaceId),
            sql`${schema.creditLedger.bucket} = 'referral'`,
          ),
        )
        .orderBy(schema.creditLedger.seq);
      let running = 0;
      const mapped = entries.map((e) => {
        running += e.delta;
        const type: ReferralActivityRow['type'] =
          e.type === 'referral_welcome'
            ? 'welcome'
            : e.type === 'referral_reward'
              ? 'reward'
              : e.type === 'referral_reversal'
                ? 'reversal'
                : e.type === 'reserve'
                  ? 'used'
                  : e.type === 'restore'
                    ? 'returned'
                    : 'adjustment';
        return {
          id: e.id,
          at: e.at,
          type,
          delta: e.delta,
          balanceAfter: Math.max(0, running),
          note: e.note,
        };
      });
      available = Math.max(0, running);
      activity = mapped.reverse().slice(0, 200);
    }
    return {
      program: {
        name: program.name,
        live: program.live,
        referrerCredits: program.referrerCredits,
        referredCredits: program.referredCredits,
        settings: program.settings,
      },
      link: identity ? { code: identity.code, status: identity.status } : null,
      summary: { successful, pending, earned, available },
      history,
      activity,
      canSeeBalance,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Administration (platform staff)

async function withReferralAdmin<T>(
  db: Database,
  staffUserId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${staffUserId}, true)`);
    await tx.execute(sql`select set_config('app.system_actor', 'billing', true)`);
    await tx.execute(sql`select st_admin_require('referrals')`);
    return fn(tx);
  });
}

export interface ReferralAdminFilters {
  from?: Date | null;
  to?: Date | null;
  status?: string | null;
  q?: string | null;
}

export async function getReferralAdmin(
  db: Database,
  staffUserId: string,
  f: ReferralAdminFilters = {},
) {
  const from = f.from ?? new Date(Date.now() - 30 * 86400_000);
  const to = f.to ?? new Date();
  return withReferralAdmin(db, staffUserId, async (tx) => {
    const program = toProgram(await programRow(tx));
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const [m] = (await tx.execute(sql`
      select
        (select count(*) from referral_identities)::int as links,
        (select count(*) from referral_identities where status = 'revoked')::int as revoked_links,
        (select coalesce(sum(visits), 0) from referral_visits where day between ${fromIso}::timestamptz::date and ${toIso}::timestamptz::date)::int as visits,
        (select count(*) from referral_attributions where registered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as registrations,
        (select count(*) from referral_attributions where verified_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as verified,
        (select count(*) from referral_attributions where qualified_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as qualified,
        (select count(*) from referral_rewards where kind = 'referrer' and issued_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as rewarded,
        (select count(*) from referral_attributions where status = 'under_review')::int as under_review,
        (select count(*) from referral_attributions where status in ('verified','awaiting_purchase') and qualification_payment_id is not null)::int as pending_rewards,
        (select count(*) from referral_attributions where status = 'rejected' and registered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as rejected,
        (select count(*) from referral_attributions where jsonb_array_length(risk_flags) > 0)::int as flagged,
        (select coalesce(sum(delta), 0) from credit_ledger where bucket = 'referral' and entry_type in ('referral_welcome','referral_reward','referral_adjustment') and delta > 0 and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as credits_issued,
        (select coalesce(-sum(delta), 0) from credit_ledger where bucket = 'referral' and entry_type in ('reserve','restore') and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::int as credits_redeemed,
        (select coalesce(sum(delta), 0) from credit_ledger where bucket = 'referral')::int as outstanding,
        (select coalesce(sum(p.amount_cents - p.amount_refunded_cents), 0) from payments p
           join referral_attributions a on a.referred_user_id = p.dispatch_as
           where p.status in ('paid','partially_refunded') and p.paid_at between ${fromIso}::timestamptz and ${toIso}::timestamptz)::bigint as sourced_revenue_cents
    `)) as unknown as Record<string, number>[];
    const conditions = [sql`true`];
    if (f.status) conditions.push(sql`a.status::text = ${f.status}`);
    if (f.q) {
      const like = `%${f.q.trim().toLowerCase()}%`;
      conditions.push(
        sql`(lower(ru.email) like ${like} or lower(ou.email) like ${like} or i.code = ${f.q.trim().toUpperCase()})`,
      );
    }
    const rows = (await tx.execute(sql`
      select a.id, a.status::text as status, a.source, a.registered_at, a.verified_at, a.qualified_at,
             a.reward_after, a.risk_flags, a.reason, a.qualification_payment_id,
             i.id as identity_id, i.code, i.status::text as code_status, i.workspace_id as referrer_workspace_id,
             ou.email as referrer_email, ou.name as referrer_name,
             ru.email as referred_email, ru.name as referred_name,
             (select coalesce(sum(r.credits), 0) from referral_rewards r where r.attribution_id = a.id and r.status = 'issued')::int as credits_issued
      from referral_attributions a
      join referral_identities i on i.id = a.identity_id
      join "user" ou on ou.id = i.owner_user_id
      join "user" ru on ru.id = a.referred_user_id
      where ${sql.join(conditions, sql` and `)}
      order by (a.status = 'under_review') desc, a.registered_at desc
      limit 200`)) as unknown as {
      id: string;
      status: string;
      source: string;
      registered_at: Date;
      verified_at: Date | null;
      qualified_at: Date | null;
      reward_after: Date | null;
      risk_flags: string[];
      reason: string | null;
      qualification_payment_id: string | null;
      identity_id: string;
      code: string;
      code_status: string;
      referrer_workspace_id: string;
      referrer_email: string;
      referrer_name: string;
      referred_email: string;
      referred_name: string;
      credits_issued: number;
    }[];
    return { program, metrics: m ?? {}, rows, range: { from, to } };
  });
}

export async function getReferralAdminDetail(db: Database, staffUserId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new AppError('not_found', 'Referral not found');
  return withReferralAdmin(db, staffUserId, async (tx) => {
    const events = await tx
      .select()
      .from(schema.referralEvents)
      .where(eq(schema.referralEvents.attributionId, id))
      .orderBy(schema.referralEvents.createdAt);
    const rewards = await tx
      .select()
      .from(schema.referralRewards)
      .where(eq(schema.referralRewards.attributionId, id));
    return { events, rewards };
  });
}

/** Staff decision on a referral held for review. Approving pays whatever is due. */
export async function reviewReferral(
  db: Database,
  staffUserId: string,
  id: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<ReferralNotice[]> {
  if (!z.string().uuid().safeParse(id).success)
    throw new AppError('not_found', 'Referral not found');
  const reason = note.trim().slice(0, 500);
  if (decision === 'reject' && !reason)
    throw new AppError('invalid', 'Give a reason for rejecting.');
  return withReferralAdmin(db, staffUserId, async (tx) => {
    const [att] = await tx
      .select()
      .from(schema.referralAttributions)
      .where(eq(schema.referralAttributions.id, id))
      .for('update');
    if (!att) throw new AppError('not_found', 'Referral not found');
    if (att.status !== 'under_review')
      throw new AppError('conflict', 'Only referrals under review can be approved or rejected.');
    await logEvent(tx, {
      attributionId: id,
      type: decision === 'approve' ? 'review.approved' : 'review.rejected',
      actorType: 'admin',
      actorUserId: staffUserId,
      data: { note: reason },
    });
    if (decision === 'reject') {
      await tx
        .update(schema.referralAttributions)
        .set({ status: 'rejected', reason: reason, updatedAt: new Date() })
        .where(eq(schema.referralAttributions.id, id));
      return [];
    }
    const program = toProgram(await programRow(tx));
    // Approved: clear the hold and continue from where it stopped.
    await tx
      .update(schema.referralAttributions)
      .set({
        status: 'verified',
        riskFlags: [],
        reason: `Approved: ${reason || 'reviewed'}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.referralAttributions.id, id));
    const notices: ReferralNotice[] = [];
    const [welcome] = await tx
      .select({ id: schema.referralRewards.id })
      .from(schema.referralRewards)
      .where(
        and(
          eq(schema.referralRewards.attributionId, id),
          eq(schema.referralRewards.kind, 'welcome'),
        ),
      );
    const fresh = { ...att, status: 'verified' as const, riskFlags: [] };
    if (!welcome) notices.push(...(await payWelcome(tx, fresh, program, 'admin', staffUserId)));
    else
      await tx
        .update(schema.referralAttributions)
        .set({ status: 'awaiting_purchase' })
        .where(eq(schema.referralAttributions.id, id));
    if (att.qualificationPaymentId)
      notices.push(...(await payReferrer(tx, id, program, 'admin', staffUserId)));
    return notices;
  });
}

/** Revokes (or restores) a referral link. Revoked links cannot attribute or earn rewards. */
export async function setReferralLinkStatus(
  db: Database,
  staffUserId: string,
  identityId: string,
  status: 'active' | 'revoked',
  reason: string,
) {
  if (!z.string().uuid().safeParse(identityId).success)
    throw new AppError('not_found', 'Link not found');
  const why = reason.trim().slice(0, 500);
  if (status === 'revoked' && !why) throw new AppError('invalid', 'Give a reason for revoking.');
  await withReferralAdmin(db, staffUserId, async (tx) => {
    const rows = await tx
      .update(schema.referralIdentities)
      .set({
        status,
        revokedAt: status === 'revoked' ? new Date() : null,
        revokedReason: status === 'revoked' ? why : null,
      })
      .where(eq(schema.referralIdentities.id, identityId))
      .returning({ id: schema.referralIdentities.id });
    if (!rows.length) throw new AppError('not_found', 'Link not found');
    await logEvent(tx, {
      identityId,
      type: status === 'revoked' ? 'link.revoked' : 'link.restored',
      actorType: 'admin',
      actorUserId: staffUserId,
      data: { reason: why },
    });
  });
}

/**
 * Adds or removes referral credits for a workspace through an audited ledger entry. Removing more
 * than the unused referral balance is refused: balances never go negative.
 */
export async function adjustReferralCredits(
  db: Database,
  staffUserId: string,
  input: { workspaceId: string; delta: number; reason: string; attributionId?: string | null },
) {
  if (!z.string().uuid().safeParse(input.workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const delta = Math.trunc(input.delta);
  if (!delta || Math.abs(delta) > 100) throw new AppError('invalid', 'Adjust by 1 to 100 credits.');
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new AppError('invalid', 'Give a reason for the adjustment.');
  return withReferralAdmin(db, staffUserId, async (tx) => {
    await lockCredits(tx, input.workspaceId);
    if (delta < 0 && (await referralBalance(tx, input.workspaceId)) < -delta)
      throw new AppError(
        'conflict',
        'That workspace does not have that many unused referral credits.',
      );
    const [{ n } = { n: 0 }] = (await tx.execute(sql`
      select count(*)::int as n from credit_ledger
      where workspace_id = ${input.workspaceId}::uuid and entry_type = 'referral_adjustment'`)) as unknown as {
      n: number;
    }[];
    await tx.insert(schema.creditLedger).values({
      workspaceId: input.workspaceId,
      entryType: 'referral_adjustment',
      bucket: 'referral',
      delta,
      idempotencyKey: `referral_adjustment:${input.workspaceId}:${n + 1}`,
      note: `Referral adjustment: ${reason}`,
      createdBy: staffUserId,
    });
    await logEvent(tx, {
      attributionId: input.attributionId ?? null,
      type: 'credits.adjusted',
      actorType: 'admin',
      actorUserId: staffUserId,
      data: { workspaceId: input.workspaceId, delta, reason },
    });
  });
}

export const referralProgramUpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'ended']),
  name: z.string().trim().min(1).max(80),
  referrerCredits: z.number().int().min(0).max(20),
  referredCredits: z.number().int().min(0).max(20),
  attributionWindowDays: z.number().int().min(1).max(365),
  qualificationDelayHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  settings: referralSettingsSchema,
});
export type ReferralProgramUpdate = z.infer<typeof referralProgramUpdateSchema>;

/**
 * Saves the program's settings. New amounts apply to rewards issued from now on; rewards already
 * issued are never changed. Every change is logged with before and after values.
 */
export async function saveReferralProgram(
  db: Database,
  staffUserId: string,
  input: ReferralProgramUpdate,
) {
  const next = referralProgramUpdateSchema.parse(input);
  await withReferralAdmin(db, staffUserId, async (tx) => {
    const before = toProgram(await programRow(tx));
    await tx
      .update(schema.referralPrograms)
      .set({
        status: next.status,
        name: next.name,
        referrerCredits: next.referrerCredits,
        referredCredits: next.referredCredits,
        attributionWindowDays: next.attributionWindowDays,
        qualificationDelayHours: next.qualificationDelayHours,
        settings: next.settings,
        updatedAt: new Date(),
      })
      .where(eq(schema.referralPrograms.key, STANDARD_PROGRAM_KEY));
    await logEvent(tx, {
      type: 'settings.updated',
      actorType: 'admin',
      actorUserId: staffUserId,
      data: {
        before: { ...before, live: undefined },
        after: next,
      },
    });
  });
}

/** CSV of the referral table for staff. */
export function referralRowsToCsv(
  rows: Awaited<ReturnType<typeof getReferralAdmin>>['rows'],
): string {
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = [
    'referral_id',
    'code',
    'referrer_email',
    'referred_email',
    'status',
    'registered_at',
    'verified_at',
    'qualified_at',
    'qualifying_payment',
    'credits_issued',
    'risk_flags',
  ];
  return [
    head.join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.code,
        r.referrer_email,
        r.referred_email,
        r.status,
        r.registered_at,
        r.verified_at,
        r.qualified_at,
        r.qualification_payment_id,
        r.credits_issued,
        (r.risk_flags ?? []).join(' '),
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\n');
}
