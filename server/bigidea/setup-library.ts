/**
 * The Setup Library (strategy documents, AI extraction, validation ratings, push to scanner) is turned off
 * (Don, 26 Nov 2026: "disable it"). SETUP_LIBRARY=on brings it back exactly as it was: no table is dropped,
 * no row is changed and no code is removed.
 *
 * While it is off, every Setup Library route answers 404 {code: "SETUP_LIBRARY_DISABLED"} before its handler runs,
 * so no upload is stored and no AI extraction or Vision call can be made. The one exception is the list
 * GET /api/bigidea/setups, which the Anima gateway reads: it answers an empty list with the header
 * X-Setup-Library: disabled, so callers keep working.
 *
 * Underneath, for when it is on: changing a setup (edit, delete, activate, archive, AI analysis, its extracted
 * ideas) needs the setup's creator, an admin or the owner. Reads and per-user ratings are unchanged.
 */
import type { NextFunction, Request, Response, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { bigideaSetups, bigideaExtractedIdeas } from "@shared/schema";
import { normalizeApiPath } from "../middleware/dataAccess";
import { sessionUserId, loadCaller, canModify } from "./access";

export const SETUP_LIBRARY_STATUS_PATH = "/api/bigidea/setup-library/status";
export const SETUP_LIBRARY_DISABLED = {
  error: "The Setup Library is turned off.",
  code: "SETUP_LIBRARY_DISABLED",
} as const;

export function setupLibraryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.SETUP_LIBRARY || "").trim().toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "yes";
}

const LIBRARY_PATHS: RegExp[] = [
  /^\/api\/bigidea\/setups(\/.*)?$/,
  /^\/api\/bigidea\/setup-indicators$/,
  /^\/api\/bigidea\/extracted-ideas(\/.*)?$/,
  /^\/api\/bigidea\/suggest-mappings$/,
  // document uploads are used only by the Setup Library (client/src/components/uploads/FileUploader.tsx)
  /^\/api\/uploads(\/.*)?$/,
  /^\/api\/setups\/[^/]+\/uploads$/,
];

export function isSetupLibraryPath(rawPath: string): boolean {
  const p = normalizeApiPath(rawPath);
  return LIBRARY_PATHS.some((rx) => rx.test(p));
}

/** Blocks every Setup Library route while the flag is off; the status route always answers. */
export function setupLibraryGuard(env: Record<string, string | undefined> = process.env): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = normalizeApiPath(req.path);
    if (p === SETUP_LIBRARY_STATUS_PATH && req.method === "GET") {
      return res.json({ enabled: setupLibraryEnabled(env) });
    }
    if (setupLibraryEnabled(env) || !isSetupLibraryPath(p)) return next();
    if (p === "/api/bigidea/setups" && (req.method === "GET" || req.method === "HEAD")) {
      res.setHeader("X-Setup-Library", "disabled");
      return res.json([]);
    }
    return res.status(404).json(SETUP_LIBRARY_DISABLED);
  };
}

const SETUP_WRITE = /^\/api\/bigidea\/setups\/(\d+)(\/(activate|archive|preview-analysis|refine-analysis|create-from-preview|analyze))?$/;
const IDEA_WRITE = /^\/api\/bigidea\/extracted-ideas\/(\d+)(\/(approve|start-validation|push-to-scanner|refine))?$/;
const LINK_UPLOAD = /^\/api\/uploads\/\d+\/link-setup$/;

/** Which setup a write request changes, or null when it changes none (reads, ratings, create). */
export async function setupIdForWrite(req: Pick<Request, "method" | "path" | "body">): Promise<number | null | "unknown-idea"> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const p = normalizeApiPath(req.path);
  const s = SETUP_WRITE.exec(p);
  if (s) return Number(s[1]);
  const i = IDEA_WRITE.exec(p);
  if (i) {
    if (!db) return null;
    const [row] = await db.select({ setupId: bigideaExtractedIdeas.setupId }).from(bigideaExtractedIdeas)
      .where(eq(bigideaExtractedIdeas.id, Number(i[1])));
    return row ? row.setupId : "unknown-idea";
  }
  if (LINK_UPLOAD.test(p)) {
    const id = Number((req.body as any)?.setupId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return null;
}

/** Changes to a setup need its creator, an admin or the owner. Missing rows fall through to the handler's 404. */
export function setupOwnershipGuard(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isSetupLibraryPath(req.path)) return next();
      const setupId = await setupIdForWrite(req);
      if (setupId === null || setupId === "unknown-idea" || !db) return next();
      const userId = sessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const [setup] = await db.select({ createdBy: bigideaSetups.createdBy }).from(bigideaSetups)
        .where(eq(bigideaSetups.id, setupId));
      if (!setup) return next();
      const caller = await loadCaller(userId);
      if (!canModify(setup.createdBy, caller)) {
        return res.status(403).json({ error: "Only the setup's creator or an admin can change it", code: "NOT_SETUP_OWNER" });
      }
      return next();
    } catch (e) {
      next(e);
    }
  };
}
