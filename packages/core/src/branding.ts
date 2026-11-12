import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import type { ObjectStorage } from './storage';
import { sha256Hex } from './signing-crypto';

/**
 * Workspace branding (spec Part 24). A logo, display name and accent colour appear on signing
 * invitations, signing pages and completion pages. Branding sits in a header area only, so it can
 * never cover the legal disclosures or security indicators, and colours must keep text readable.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of white text on the colour. */
export function contrastWithWhite(hex: string) {
  return 1.05 / (luminance(hex) + 0.05);
}

export const brandingSchema = z.object({
  brandName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((v) => v || null),
  brandColor: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^#[0-9a-f]{6}$/.test(v), 'Use a colour like #7a1e3a')
    .refine(
      (v) => v === null || contrastWithWhite(v) >= 4.5,
      'This colour is too light for white text on buttons. Choose a darker shade.',
    ),
});
export type BrandingInput = z.input<typeof brandingSchema>;

export interface Brand {
  name: string;
  brandName: string | null;
  color: string | null;
  hasLogo: boolean;
  logoSha256: string | null;
}

async function requireManage(
  tx: Parameters<Parameters<typeof withActor>[2]>[0],
  workspaceId: string,
) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${workspaceId}::uuid, 'workspace.manage') as ok`,
  )) as unknown as { ok: boolean }[];
  if (!r?.ok)
    throw new AppError('forbidden', 'Only workspace owners and admins can change branding.');
}

export async function saveBranding(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: BrandingInput,
  meta: Meta = {},
) {
  const input = brandingSchema.parse(raw);
  await withActor(db, actor, async (tx) => {
    await requireManage(tx, workspaceId);
    await tx
      .update(schema.workspaces)
      .set({ brandName: input.brandName, brandColor: input.brandColor, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, workspaceId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.branding_updated',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: input,
      ...meta,
    });
  });
}

const LOGO_TYPES = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
} as const;

/** Detects PNG or JPEG from the file's bytes. SVG is refused because it can carry scripts. */
export function sniffLogo(bytes: Uint8Array): keyof typeof LOGO_TYPES | null {
  for (const [type, magic] of Object.entries(LOGO_TYPES))
    if (magic.every((b, i) => bytes[i] === b)) return type as keyof typeof LOGO_TYPES;
  return null;
}

export async function uploadLogo(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  workspaceId: string,
  bytes: Uint8Array,
  meta: Meta = {},
) {
  if (bytes.byteLength > 512 * 1024) throw new AppError('invalid', 'Use a logo under 512 KB.');
  const type = sniffLogo(bytes);
  if (!type) throw new AppError('invalid', 'Upload a PNG or JPEG image.');
  const allowed = await withActor(db, actor, async (tx) => {
    await requireManage(tx, workspaceId);
    return true;
  });
  if (!allowed) return;
  const sha = sha256Hex(bytes);
  const key = `ws/${workspaceId}/brand/${sha}.${type === 'image/png' ? 'png' : 'jpg'}`;
  await storage.put(key, bytes, type);
  await withActor(db, actor, async (tx) => {
    await tx
      .update(schema.workspaces)
      .set({ brandLogoKey: key, brandLogoType: type, brandLogoSha256: sha, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, workspaceId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.logo_updated',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { sha256: sha, bytes: bytes.byteLength, type },
      ...meta,
    });
  });
}

export async function removeLogo(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    await requireManage(tx, workspaceId);
    await tx
      .update(schema.workspaces)
      .set({
        brandLogoKey: null,
        brandLogoType: null,
        brandLogoSha256: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.logo_removed',
      targetType: 'workspace',
      targetId: workspaceId,
      ...meta,
    });
  });
}

type BrandRow = {
  name: string;
  brand_name: string | null;
  brand_color: string | null;
  logo_key: string | null;
  logo_type: string | null;
  logo_sha256: string | null;
};

async function brandRow(db: Database, workspaceId: string): Promise<BrandRow | null> {
  if (!z.string().uuid().safeParse(workspaceId).success) return null;
  const rows = (await db.transaction((tx) =>
    tx.execute(sql`select * from st_workspace_brand(${workspaceId}::uuid)`),
  )) as unknown as BrandRow[];
  return rows[0] ?? null;
}

/** Public branding for invitations and signing pages. */
export async function getBrand(db: Database, workspaceId: string): Promise<Brand | null> {
  const r = await brandRow(db, workspaceId);
  if (!r) return null;
  return {
    name: r.name,
    brandName: r.brand_name,
    color: r.brand_color,
    hasLogo: Boolean(r.logo_key),
    logoSha256: r.logo_sha256,
  };
}

export async function readLogo(db: Database, storage: ObjectStorage, workspaceId: string) {
  const r = await brandRow(db, workspaceId);
  if (!r?.logo_key || !r.logo_type) throw new AppError('not_found', 'No logo');
  const bytes = await storage.get(r.logo_key);
  if (sha256Hex(bytes) !== r.logo_sha256)
    throw new Error(`Integrity check failed for logo of ${workspaceId}`);
  return { bytes, type: r.logo_type, sha256: r.logo_sha256! };
}
