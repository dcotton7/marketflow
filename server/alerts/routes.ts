import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { createAlertDefinitionSchema, updateAlertDefinitionSchema } from "@shared/alerts";
import { alertDeliveries, alertEvents, alertSymbolStates, userAlerts } from "@shared/schema";
import { db } from "../db";
import { clearAlertSequenceState, evaluateAlertDefinition, evaluateStoredAlertById } from "./evaluator";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerAlertRoutes(app: Express): void {
  app.post("/api/alerts/deliveries/twilio-status", async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const deliveryId = Number(req.query.deliveryId);
      const messageSid = typeof req.body?.MessageSid === "string" ? req.body.MessageSid : null;
      const messageStatus = typeof req.body?.MessageStatus === "string" ? req.body.MessageStatus : null;
      const errorCode = req.body?.ErrorCode != null ? String(req.body.ErrorCode) : null;
      const errorMessage = typeof req.body?.ErrorMessage === "string" ? req.body.ErrorMessage : null;
      const resolvedStatus =
        messageStatus === "delivered" ? "delivered" :
        messageStatus === "failed" || messageStatus === "undelivered" || messageStatus === "canceled" ? "failed" :
        "provider_accepted";

      if (Number.isFinite(deliveryId)) {
        await db
          .update(alertDeliveries)
          .set({
            status: resolvedStatus,
            providerMessageId: messageSid,
            providerStatus: messageStatus,
            providerErrorCode: errorCode,
            providerPayload: req.body ?? null,
            errorMessage,
            deliveredAt: resolvedStatus === "delivered" ? new Date() : null,
            providerStatusAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(alertDeliveries.id, deliveryId));
        return res.sendStatus(204);
      }

      if (messageSid) {
        await db
          .update(alertDeliveries)
          .set({
            status: resolvedStatus,
            providerStatus: messageStatus,
            providerErrorCode: errorCode,
            providerPayload: req.body ?? null,
            errorMessage,
            deliveredAt: resolvedStatus === "delivered" ? new Date() : null,
            providerStatusAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(alertDeliveries.providerMessageId, messageSid));
      }

      res.sendStatus(204);
    } catch (error) {
      console.error("[Alerts] twilio status update failed:", error);
      res.status(500).json({ error: "Failed to update Twilio delivery status" });
    }
  });

  app.post("/api/alerts/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = createAlertDefinitionSchema.parse(req.body);
      const result = await evaluateAlertDefinition(req.session.userId!, data);
      res.json(result);
    } catch (error) {
      console.error("[Alerts] preview failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to preview alert",
      });
    }
  });

  app.get("/api/alerts", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alerts = await db
        .select()
        .from(userAlerts)
        .where(eq(userAlerts.userId, req.session.userId!))
        .orderBy(desc(userAlerts.updatedAt), desc(userAlerts.id));

      res.json(alerts);
    } catch (error) {
      console.error("[Alerts] list failed:", error);
      res.status(500).json({ error: "Failed to load alerts" });
    }
  });

  app.get("/api/alerts/events", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const events = await db
        .select()
        .from(alertEvents)
        .where(eq(alertEvents.userId, req.session.userId!))
        .orderBy(desc(alertEvents.createdAt), desc(alertEvents.id))
        .limit(limit);

      res.json(events);
    } catch (error) {
      console.error("[Alerts] event list failed:", error);
      res.status(500).json({ error: "Failed to load alert events" });
    }
  });

  app.get("/api/alerts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const rows = await db
        .select()
        .from(userAlerts)
        .where(and(eq(userAlerts.id, alertId), eq(userAlerts.userId, req.session.userId!)))
        .limit(1);

      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Alert not found" });

      const recentEvents = await db
        .select()
        .from(alertEvents)
        .where(and(eq(alertEvents.alertId, alertId), eq(alertEvents.userId, req.session.userId!)))
        .orderBy(desc(alertEvents.createdAt), desc(alertEvents.id))
        .limit(10);

      res.json({ alert: row, recentEvents });
    } catch (error) {
      console.error("[Alerts] get failed:", error);
      res.status(500).json({ error: "Failed to load alert" });
    }
  });

  app.post("/api/alerts", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const data = createAlertDefinitionSchema.parse(req.body);
      const inserted = await db
        .insert(userAlerts)
        .values({
          userId: req.session.userId!,
          name: data.name,
          description: data.description ?? null,
          sourceClient: data.sourceClient,
          targetScope: data.targetScope,
          ruleTree: data.ruleTree,
          evaluationConfig: data.evaluationConfig,
          deliveryConfig: data.deliveryConfig,
          expirationAt: data.expirationAt ? new Date(data.expirationAt) : null,
          enabled: data.enabled ?? true,
          isPaused: false,
        })
        .returning();

      const createdAlert = inserted[0];
      if (!createdAlert) {
        return res.status(500).json({ error: "Failed to create alert" });
      }

      let initialEvaluation = null;
      // New alerts should be live immediately, not after the next worker tick.
      if (createdAlert.enabled) {
        try {
          initialEvaluation = await evaluateStoredAlertById(req.session.userId!, createdAlert.id, true);
        } catch (error) {
          console.warn("[Alerts] immediate post-create evaluation failed", error);
        }
      }

      const refreshed = await db
        .select()
        .from(userAlerts)
        .where(and(eq(userAlerts.id, createdAlert.id), eq(userAlerts.userId, req.session.userId!)))
        .limit(1);

      res.status(201).json({
        alert: refreshed[0] ?? createdAlert,
        initialEvaluation,
      });
    } catch (error) {
      console.error("[Alerts] create failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create alert",
      });
    }
  });

  app.patch("/api/alerts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const data = updateAlertDefinitionSchema.parse(req.body);
      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (data.name !== undefined) updates.name = data.name;
      if (data.description !== undefined) updates.description = data.description ?? null;
      if (data.sourceClient !== undefined) updates.sourceClient = data.sourceClient;
      if (data.targetScope !== undefined) updates.targetScope = data.targetScope;
      if (data.ruleTree !== undefined) updates.ruleTree = data.ruleTree;
      if (data.evaluationConfig !== undefined) updates.evaluationConfig = data.evaluationConfig;
      if (data.deliveryConfig !== undefined) updates.deliveryConfig = data.deliveryConfig;
      if (data.expirationAt !== undefined) updates.expirationAt = data.expirationAt ? new Date(data.expirationAt) : null;
      if (data.enabled !== undefined) updates.enabled = data.enabled;

      const updated = await db
        .update(userAlerts)
        .set(updates)
        .where(and(eq(userAlerts.id, alertId), eq(userAlerts.userId, req.session.userId!)))
        .returning();

      if (!updated[0]) return res.status(404).json({ error: "Alert not found" });
      clearAlertSequenceState(req.session.userId!, alertId);
      try {
        await db
          .delete(alertSymbolStates)
          .where(and(eq(alertSymbolStates.alertId, alertId), eq(alertSymbolStates.userId, req.session.userId!)));
      } catch (error) {
        console.warn("[Alerts] failed clearing sequence states on update", error);
      }
      res.json(updated[0]);
    } catch (error) {
      console.error("[Alerts] update failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update alert",
      });
    }
  });

  app.post("/api/alerts/:id/toggle", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const rows = await db
        .select()
        .from(userAlerts)
        .where(and(eq(userAlerts.id, alertId), eq(userAlerts.userId, req.session.userId!)))
        .limit(1);
      const alert = rows[0];
      if (!alert) return res.status(404).json({ error: "Alert not found" });

      const updated = await db
        .update(userAlerts)
        .set({
          enabled: !alert.enabled,
          isPaused: alert.enabled,
          updatedAt: new Date(),
        })
        .where(eq(userAlerts.id, alertId))
        .returning();

      if (alert.enabled) {
        clearAlertSequenceState(req.session.userId!, alertId);
        try {
          await db
            .delete(alertSymbolStates)
            .where(and(eq(alertSymbolStates.alertId, alertId), eq(alertSymbolStates.userId, req.session.userId!)));
        } catch (error) {
          console.warn("[Alerts] failed clearing sequence states on toggle", error);
        }
      }

      res.json(updated[0]);
    } catch (error) {
      console.error("[Alerts] toggle failed:", error);
      res.status(500).json({ error: "Failed to toggle alert" });
    }
  });

  app.delete("/api/alerts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const deleted = await db
        .delete(userAlerts)
        .where(and(eq(userAlerts.id, alertId), eq(userAlerts.userId, req.session.userId!)))
        .returning();

      if (!deleted[0]) return res.status(404).json({ error: "Alert not found" });
      clearAlertSequenceState(req.session.userId!, alertId);
      try {
        await db
          .delete(alertSymbolStates)
          .where(and(eq(alertSymbolStates.alertId, alertId), eq(alertSymbolStates.userId, req.session.userId!)));
      } catch (error) {
        console.warn("[Alerts] failed clearing sequence states on delete", error);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[Alerts] delete failed:", error);
      res.status(500).json({ error: "Failed to delete alert" });
    }
  });

  app.get("/api/alerts/:id/deliveries", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!db) return res.status(500).json({ error: "Database not available" });

      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const deliveries = await db
        .select()
        .from(alertDeliveries)
        .where(eq(alertDeliveries.alertId, alertId))
        .orderBy(desc(alertDeliveries.attemptedAt), desc(alertDeliveries.id))
        .limit(25);

      res.json(deliveries);
    } catch (error) {
      console.error("[Alerts] delivery list failed:", error);
      res.status(500).json({ error: "Failed to load alert deliveries" });
    }
  });

  app.post("/api/alerts/:id/evaluate", requireAuth, async (req: Request, res: Response) => {
    try {
      const alertId = Number(req.params.id);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Invalid alert id" });
      }

      const persistEvent = req.query.persist !== "false";
      const result = await evaluateStoredAlertById(req.session.userId!, alertId, persistEvent);
      if (!result) return res.status(404).json({ error: "Alert not found" });

      res.json(result);
    } catch (error) {
      console.error("[Alerts] evaluate failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to evaluate alert",
      });
    }
  });
}
