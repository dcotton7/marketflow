import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sentinelModels } from "../sentinel/models";
import { requireSentinelAuth } from "./requireSentinelAuth";

/**
 * Logged-in, active Sentinel user with is_admin = true.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireSentinelAuth(req, res, async () => {
    try {
      if (!db) {
        return res.status(503).json({ error: "Service unavailable" });
      }
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      next();
    } catch (e) {
      next(e);
    }
  });
}
