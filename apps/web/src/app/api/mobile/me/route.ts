import { getMembership, hasPermission, listMyWorkspaces } from '@st/core';
import { apiError } from '@/lib/api';
import { db } from '@/lib/db';
import { json, requireApiUser } from '@/lib/mobile-api';
import { WORKSPACE_HEADER } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Who is signed in to the mobile app, their workspaces, and what they may do in the current one.
 * The app sends its chosen workspace in the x-st-workspace header; membership is checked here.
 */
export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    const actor = { userId: user.id };
    const workspaces = await listMyWorkspaces(db(), actor);
    const wanted = req.headers.get(WORKSPACE_HEADER);
    const chosen = workspaces.find((w) => w.id === wanted) ?? workspaces[0] ?? null;
    const membership = chosen ? await getMembership(db(), actor, chosen.id) : null;
    const can = (p: Parameters<typeof hasPermission>[1]) =>
      Boolean(membership && hasPermission(membership.permissions, p));
    return json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.roleName })),
      workspace: membership
        ? {
            id: membership.workspace.id,
            name: membership.workspace.name,
            role: membership.roleName,
          }
        : null,
      can: { create: can('documents.create'), send: can('documents.send') },
    });
  } catch (err) {
    return apiError(err);
  }
}
