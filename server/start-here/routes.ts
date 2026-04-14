import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "../db";
import { requireSentinelAuth as requireAuth } from "../middleware/requireSentinelAuth";
import { startHereWorkspaces, startHereUserState } from "@shared/schema";

const START_HERE_MISSING_TABLES_MSG =
  "Start Here database tables are missing. From the project root run: npm run db:ensure-start-here (or npm run db:push). DATABASE_URL must be set.";

function pgErrorChain(e: unknown): unknown[] {
  const out: unknown[] = [e];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    cur = (cur as { cause: unknown }).cause;
    out.push(cur);
  }
  return out;
}

function isMissingStartHereTables(e: unknown): boolean {
  for (const err of pgErrorChain(e)) {
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    if (code === "42P01") return true;
    const msg = err instanceof Error ? err.message : String(err);
    if (/start_here_workspaces|start_here_user_state/i.test(msg) && /does not exist/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function respondStartHereDbError(res: Response, e: unknown): boolean {
  if (!isMissingStartHereTables(e)) return false;
  res.status(503).json({ error: START_HERE_MISSING_TABLES_MSG });
  return true;
}

const putWorkspaceBodySchema = z.object({
  name: z.string().min(1).max(200),
  dashboard: z.unknown(),
  extras: z.record(z.string(), z.unknown()).optional(),
});

const patchActiveBodySchema = z.object({
  workspaceId: z.string().min(1).max(200),
});

export function registerStartHereRoutes(app: Express): void {
  app.get("/api/sentinel/start-here/bootstrap", requireAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const userId = req.session!.userId!;

      const rows = await db
        .select()
        .from(startHereWorkspaces)
        .where(eq(startHereWorkspaces.userId, userId))
        .orderBy(asc(startHereWorkspaces.createdAt));

      const prefs = await db
        .select()
        .from(startHereUserState)
        .where(eq(startHereUserState.userId, userId))
        .limit(1);

      res.json({
        activeWorkspaceId: prefs[0]?.activeWorkspaceId ?? null,
        workspaces: rows.map((r) => ({
          workspaceId: r.workspaceId,
          name: r.name,
          dashboard: r.dashboard,
          extras: r.extras && typeof r.extras === "object" ? r.extras : {},
        })),
      });
    } catch (e) {
      console.error("start-here bootstrap error:", e);
      if (respondStartHereDbError(res, e)) return;
      res.status(500).json({ error: "Failed to load Start workspaces" });
    }
  });

  app.put("/api/sentinel/start-here/workspace/:workspaceId", requireAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const userId = req.session!.userId!;
      const workspaceId = req.params.workspaceId;
      if (!workspaceId || workspaceId.length > 200) {
        return res.status(400).json({ error: "Invalid workspace id" });
      }
      const body = putWorkspaceBodySchema.parse(req.body);

      await db
        .insert(startHereWorkspaces)
        .values({
          userId,
          workspaceId,
          name: body.name,
          dashboard: body.dashboard,
          extras: body.extras ?? {},
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [startHereWorkspaces.userId, startHereWorkspaces.workspaceId],
          set: {
            name: body.name,
            dashboard: body.dashboard,
            extras: body.extras ?? {},
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: e.errors[0]?.message ?? "Invalid body" });
      }
      console.error("start-here put workspace error:", e);
      if (respondStartHereDbError(res, e)) return;
      res.status(500).json({ error: "Failed to save workspace" });
    }
  });

  app.delete("/api/sentinel/start-here/workspace/:workspaceId", requireAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const userId = req.session!.userId!;
      const workspaceId = req.params.workspaceId;
      await db
        .delete(startHereWorkspaces)
        .where(
          and(eq(startHereWorkspaces.userId, userId), eq(startHereWorkspaces.workspaceId, workspaceId))
        );
      res.json({ ok: true });
    } catch (e) {
      console.error("start-here delete workspace error:", e);
      if (respondStartHereDbError(res, e)) return;
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  });

  app.patch("/api/sentinel/start-here/active", requireAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const userId = req.session!.userId!;
      const { workspaceId } = patchActiveBodySchema.parse(req.body);

      await db
        .insert(startHereUserState)
        .values({
          userId,
          activeWorkspaceId: workspaceId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: startHereUserState.userId,
          set: {
            activeWorkspaceId: workspaceId,
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: e.errors[0]?.message ?? "Invalid body" });
      }
      console.error("start-here patch active error:", e);
      if (respondStartHereDbError(res, e)) return;
      res.status(500).json({ error: "Failed to set active workspace" });
    }
  });
}
