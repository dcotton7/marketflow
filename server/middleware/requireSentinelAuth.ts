import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sentinelModels } from "../sentinel/models";

/**
 * Requires a logged-in Sentinel user that exists and has is_active = true.
 */
export async function requireSentinelAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (db) {
      const user = await sentinelModels.getUserById(req.session.userId);
      if (!user || user.isActive === false) {
        await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
        return res.status(403).json({ error: "Account disabled" });
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}
