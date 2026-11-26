/**
 * Who is calling a BigIdea route, and may they change a given row.
 *
 * Every BigIdea route reads the signed-in user from the session (`req.session.userId`), as the app's access guard
 * does (server/middleware/dataAccess.ts). The Anima gateway sets the same field for its request
 * (ANIMA_GATEWAY_USER_ID), so it needs nothing different. `req.user` is never set in this app: do not use it.
 */
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sentinelUsers } from "@shared/schema";
import { isOwnerUser, loadOwnerConfig, type OwnerConfig } from "../middleware/dataAccess";

export interface Caller {
  id: number;
  isAdmin?: boolean | null;
  isActive?: boolean | null;
  tier?: string | null;
}

export function sessionUserId(req: Pick<Request, "session">): number | null {
  const raw = (req.session as any)?.userId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function loadCaller(userId: number): Promise<Caller | null> {
  if (!db) return null;
  const rows = await db
    .select({ id: sentinelUsers.id, isAdmin: sentinelUsers.isAdmin, isActive: sentinelUsers.isActive, tier: sentinelUsers.tier })
    .from(sentinelUsers)
    .where(eq(sentinelUsers.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Admin by flag or tier, or the app's owner (OWNER_USER_IDS, else is_admin). */
export function isAdminOrOwner(caller: Caller | null | undefined, config: OwnerConfig = loadOwnerConfig()): boolean {
  if (!caller || caller.isActive === false) return false;
  return caller.isAdmin === true || caller.tier === "admin" || isOwnerUser(caller, config);
}

/**
 * May `caller` edit or delete a row created by `creatorId`? The creator may; so may an admin or the owner.
 * A row with no creator (made before creators were recorded) counts as the owner's: only admin/owner.
 */
export function canModify(
  creatorId: number | null | undefined,
  caller: Caller | null | undefined,
  config: OwnerConfig = loadOwnerConfig(),
): boolean {
  if (!caller || caller.isActive === false) return false;
  if (creatorId != null && creatorId === caller.id) return true;
  return isAdminOrOwner(caller, config);
}
