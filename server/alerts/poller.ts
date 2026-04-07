import { and, eq } from "drizzle-orm";
import type { AlertReferenceOperand, AlertRuleCondition, AlertRuleGroup } from "@shared/alerts";
import { alertDeliveries, userAlerts } from "@shared/schema";
import { getDb } from "../db";
import { evaluateStoredAlertById } from "./evaluator";
import { getMarketSession } from "../market-condition/universe";
import { fetchTwilioMessageStatus } from "../messages/providers/twilio";

let pollerStarted = false;
let pollerTimer: NodeJS.Timeout | null = null;
let pollerRunning = false;

const MARKET_HOURS_POLL_MS = 30_000;
const AFTER_HOURS_POLL_MS = 2 * 60_000;
const CLOSED_POLL_MS = 5 * 60_000;

function getPollIntervalMs(): number {
  const session = getMarketSession();
  if (session === "MARKET_HOURS") return MARKET_HOURS_POLL_MS;
  if (session === "AFTER_HOURS") return AFTER_HOURS_POLL_MS;
  return CLOSED_POLL_MS;
}

function scheduleNextPoll(delayMs: number = getPollIntervalMs()): void {
  if (pollerTimer) clearTimeout(pollerTimer);
  pollerTimer = setTimeout(() => {
    void runAlertPollCycle();
  }, delayMs);
}

function isReferenceSupportedAfterHours(reference: AlertReferenceOperand): boolean {
  return reference.kind !== "sma" && reference.kind !== "ema";
}

function isConditionSupportedAfterHours(condition: AlertRuleCondition): boolean {
  if (condition.rowType === "price_reference" || condition.rowType === "price_distance") {
    return isReferenceSupportedAfterHours(condition.reference);
  }

  return condition.rowType === "trade_plan_reference";
}

function isRuleTreeSupportedAfterHours(ruleTree: AlertRuleGroup): boolean {
  return ruleTree.children.every((child) =>
    "nodeType" in child
      ? isRuleTreeSupportedAfterHours(child)
      : isConditionSupportedAfterHours(child)
  );
}

function isAlertExpired(expirationAt: Date | null): boolean {
  return expirationAt != null && expirationAt.getTime() <= Date.now();
}

function isAlertCoolingDown(lastTriggeredAt: Date | null, cooldownMinutes: number | undefined): boolean {
  const cooldownMs = Math.max(0, cooldownMinutes ?? 0) * 60_000;
  if (!lastTriggeredAt || cooldownMs <= 0) return false;
  return Date.now() - lastTriggeredAt.getTime() < cooldownMs;
}

async function runAlertPollCycle(): Promise<void> {
  if (pollerRunning) {
    scheduleNextPoll();
    return;
  }

  const db = getDb();
  if (!db) {
    scheduleNextPoll();
    return;
  }

  pollerRunning = true;
  const session = getMarketSession();
  const startedAt = Date.now();
  let scanned = 0;
  let evaluated = 0;
  let matched = 0;
  let reconciled = 0;

  try {
    const pendingSmsDeliveries = await db
      .select()
      .from(alertDeliveries)
      .where(and(eq(alertDeliveries.channel, "sms"), eq(alertDeliveries.status, "provider_accepted")));

    for (const delivery of pendingSmsDeliveries) {
      if (!delivery.providerMessageId) continue;

      try {
        const smsStatus = await fetchTwilioMessageStatus(delivery.providerMessageId);
        await db
          .update(alertDeliveries)
          .set({
            status:
              smsStatus.providerStatus === "delivered" ? "delivered" :
              smsStatus.providerStatus === "failed" || smsStatus.providerStatus === "undelivered" || smsStatus.providerStatus === "canceled"
                ? "failed"
                : "provider_accepted",
            providerStatus: smsStatus.providerStatus ?? null,
            providerErrorCode: smsStatus.providerErrorCode ?? null,
            providerPayload: smsStatus.providerPayload ?? null,
            errorMessage: smsStatus.errorMessage ?? null,
            deliveredAt: smsStatus.providerStatus === "delivered" ? new Date() : null,
            providerStatusAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(alertDeliveries.id, delivery.id));
        reconciled += 1;
      } catch (error) {
        console.warn("[AlertsWorker] failed refreshing Twilio delivery status", error);
      }
    }

    const alerts = await db
      .select()
      .from(userAlerts)
      .where(and(eq(userAlerts.enabled, true), eq(userAlerts.isPaused, false)));

    for (const alert of alerts) {
      scanned += 1;

      if (isAlertExpired(alert.expirationAt ?? null)) continue;
      if (isAlertCoolingDown(alert.lastTriggeredAt ?? null, alert.evaluationConfig?.cooldownMinutes)) continue;
      if (session === "CLOSED") continue;
      if (session === "AFTER_HOURS" && !isRuleTreeSupportedAfterHours(alert.ruleTree)) continue;

      const result = await evaluateStoredAlertById(alert.userId, alert.id, true);
      evaluated += 1;
      matched += result?.matchedCount ?? 0;
    }

    console.log(
      `[AlertsWorker] cycle complete session=${session} scanned=${scanned} evaluated=${evaluated} matched=${matched} reconciled=${reconciled} elapsedMs=${Date.now() - startedAt}`
    );
  } catch (error) {
    console.error("[AlertsWorker] cycle failed:", error);
  } finally {
    pollerRunning = false;
    scheduleNextPoll();
  }
}

export function startAlertPollingWorker(): void {
  if (pollerStarted || process.env.ALERT_POLLING_DISABLED === "true") return;
  pollerStarted = true;
  console.log("[AlertsWorker] starting background alert polling worker");
  scheduleNextPoll(15_000);
}
