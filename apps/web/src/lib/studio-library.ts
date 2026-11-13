import 'server-only';
import { listLibrary } from '@st/core/studio/server';
import type { LibraryItem } from '@/components/studio/library';
import { db } from './db';
import { designSvg } from './studio';

export async function libraryItems(userId: string): Promise<LibraryItem[]> {
  const list = await listLibrary(db(), userId);
  return Promise.all(
    list.map(async (d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      status: d.status,
      style: d.style,
      isDefault: d.isDefault,
      access: d.access,
      purchasedAt: d.purchasedAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
      purchaseId: d.purchaseId,
      svg: await designSvg(d.design, { width: 420 }).catch(() => ''),
    })),
  );
}
