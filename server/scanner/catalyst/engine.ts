// ---------------------------------------------------------------------------
// Catalyst Detector Engine
//
// Manages the lifecycle of catalyst entries: create, decay, resolve, query.
// In-memory cache with periodic DB sync for speed.
// ---------------------------------------------------------------------------

import { getDb } from "../../db";
import { sql } from "drizzle-orm";
import {
  computeDecayWeight,
  scoreHeadlineSeverity,
  type CatalystEntry,
  type CatalystType,
  type CatalystSubjectKind,
  type InitialReaction,
  type ExpectedDirection,
  type DecayShape,
  type CatalystRuleDefinition,
} from "@shared/catalyst-types";

// ── In-memory cache ─────────────────────────────────────────────────────────

let activeCatalysts: CatalystEntry[] = [];
let catalystRules: CatalystRuleDefinition[] = [];
let lastDbSyncAt = 0;
const DB_SYNC_INTERVAL_MS = 60_000;

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createCatalyst(params: {
  subject: string;
  subjectKind: CatalystSubjectKind;
  catalystType: CatalystType;
  headline: string;
  source: CatalystEntry["source"];
  initialReaction: InitialReaction;
  expectedDirection: ExpectedDirection;
  windowDays: number;
  decayShape: DecayShape;
  ruleId?: string;
  ownerId?: number;
  notes?: string;
}): Promise<CatalystEntry | null> {
  const db = getDb();
  if (!db) return null;

  // Prevent duplicates: same subject + type within 24 hours
  const existing = activeCatalysts.find(
    (c) =>
      c.subject === params.subject &&
      c.catalystType === params.catalystType &&
      !c.resolved &&
      Date.now() - new Date(c.firedAt).getTime() < 24 * 60 * 60_000
  );
  if (existing) return existing;

  const firedAt = new Date();
  const expiresAt = addTradingDays(firedAt, params.windowDays);

  try {
    const result = await db.execute(sql`
      INSERT INTO catalyst_detectors
        (subject, subject_kind, catalyst_type, headline, source,
         fired_at, expires_at, initial_reaction, expected_direction,
         decay_weight, rule_id, owner_id, notes)
      VALUES
        (${params.subject}, ${params.subjectKind}, ${params.catalystType},
         ${params.headline}, ${params.source},
         ${firedAt.toISOString()}, ${expiresAt.toISOString()},
         ${params.initialReaction}, ${params.expectedDirection},
         ${1.0}, ${params.ruleId ?? null}, ${params.ownerId ?? null},
         ${params.notes ?? null})
      RETURNING *
    `);

    const row = (result as any).rows?.[0];
    if (!row) return null;

    const entry = rowToCatalystEntry(row);
    activeCatalysts.push(entry);

    console.log(
      `[Catalyst] Created: ${params.catalystType} for ${params.subject} ` +
      `(${params.initialReaction} reaction, ${params.windowDays}d window)`
    );

    return entry;
  } catch (err) {
    console.error("[Catalyst] Failed to create entry:", err);
    return null;
  }
}

export async function resolveCatalyst(
  id: number,
  magnitude: number
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.execute(sql`
      UPDATE catalyst_detectors
      SET resolved = TRUE,
          resolved_at = NOW(),
          resolution_magnitude = ${magnitude}
      WHERE id = ${id}
    `);

    const entry = activeCatalysts.find((c) => c.id === id);
    if (entry) {
      entry.resolved = true;
      entry.resolvedAt = new Date().toISOString();
      entry.resolutionMagnitude = magnitude;
    }

    console.log(`[Catalyst] Resolved #${id} with magnitude ${magnitude}`);
  } catch (err) {
    console.error(`[Catalyst] Failed to resolve #${id}:`, err);
  }
}

// ── Query ───────────────────────────────────────────────────────────────────

export function getActiveCatalystsForSubject(subject: string): CatalystEntry[] {
  return activeCatalysts.filter(
    (c) => c.subject === subject && !c.resolved && new Date(c.expiresAt) > new Date()
  );
}

export function getActiveCatalystsForSubjects(subjects: string[]): Map<string, CatalystEntry[]> {
  const map = new Map<string, CatalystEntry[]>();
  const now = new Date();
  for (const c of activeCatalysts) {
    if (c.resolved || new Date(c.expiresAt) <= now) continue;
    if (!subjects.includes(c.subject)) continue;
    const list = map.get(c.subject) ?? [];
    list.push(c);
    map.set(c.subject, list);
  }
  return map;
}

export function getAllActiveCatalysts(): CatalystEntry[] {
  const now = new Date();
  return activeCatalysts.filter((c) => !c.resolved && new Date(c.expiresAt) > now);
}

export function getCatalystRules(): CatalystRuleDefinition[] {
  return catalystRules;
}

export function getEnabledRules(): CatalystRuleDefinition[] {
  return catalystRules.filter((r) => r.enabled);
}

// ── Rule update ─────────────────────────────────────────────────────────

type RuleUpdatable = Partial<Pick<CatalystRuleDefinition, "enabled" | "windowDays" | "decayShape" | "boostMultiplier" | "keywords" | "minNewsSeverity" | "contraryThresholdPct">>;

export async function updateCatalystRule(
  id: string,
  updates: RuleUpdatable
): Promise<CatalystRuleDefinition | null> {
  const db = getDb();
  if (!db) return null;

  const existing = catalystRules.find((r) => r.id === id);
  if (!existing) return null;

  const merged = { ...existing, ...updates };

  try {
    const result = await db.execute(sql`
      UPDATE catalyst_rules
      SET enabled              = ${merged.enabled},
          window_days          = ${merged.windowDays},
          decay_shape          = ${merged.decayShape},
          boost_multiplier     = ${merged.boostMultiplier},
          min_news_severity    = ${merged.minNewsSeverity},
          keywords             = ${merged.keywords},
          contrary_threshold_pct = ${merged.contraryThresholdPct},
          updated_at           = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    const row = (result as any).rows?.[0];
    if (!row) return null;

    const updated = rowToRule(row);
    const cacheIdx = catalystRules.findIndex((r) => r.id === id);
    if (cacheIdx >= 0) catalystRules[cacheIdx] = updated;

    console.log(`[Catalyst] Rule updated: ${id} — ${Object.keys(updates).join(", ")}`);
    return updated;
  } catch (err) {
    console.error(`[Catalyst] Failed to update rule ${id}:`, err);
    return null;
  }
}

// ── Decay update (run periodically) ─────────────────────────────────────────

export function updateDecayWeights(): void {
  const now = new Date();
  for (const entry of activeCatalysts) {
    if (entry.resolved) continue;
    if (new Date(entry.expiresAt) <= now) continue;

    const rule = catalystRules.find((r) => r.id === entry.ruleId);
    const shape: DecayShape = rule?.decayShape ?? "linear";
    const windowDays = rule?.windowDays ?? 5;

    const daysSinceFired = tradingDaysBetween(new Date(entry.firedAt), now);
    entry.decayWeight = computeDecayWeight(shape, daysSinceFired, windowDays);
  }
}

// ── Score boost calculation ─────────────────────────────────────────────────

export function getCatalystBoost(subject: string): number {
  const catalysts = getActiveCatalystsForSubject(subject);
  if (catalysts.length === 0) return 0;

  let maxBoost = 0;
  for (const c of catalysts) {
    const rule = catalystRules.find((r) => r.id === c.ruleId);
    const multiplier = rule?.boostMultiplier ?? 1.0;
    const boost = c.decayWeight * multiplier * 25;
    if (boost > maxBoost) maxBoost = boost;
  }

  return Math.round(maxBoost);
}

// ── DB sync ─────────────────────────────────────────────────────────────────

export async function syncFromDb(): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const catalystRows = await db.execute(sql`
      SELECT * FROM catalyst_detectors
      WHERE resolved = FALSE AND expires_at > NOW()
      ORDER BY fired_at DESC
      LIMIT 500
    `);
    activeCatalysts = ((catalystRows as any).rows ?? []).map(rowToCatalystEntry);

    const ruleRows = await db.execute(sql`
      SELECT * FROM catalyst_rules ORDER BY name
    `);
    catalystRules = ((ruleRows as any).rows ?? []).map(rowToRule);

    lastDbSyncAt = Date.now();
  } catch (err) {
    console.warn("[Catalyst] DB sync failed (tables may not exist yet):", err);
  }
}

export async function ensureSynced(): Promise<void> {
  if (Date.now() - lastDbSyncAt > DB_SYNC_INTERVAL_MS) {
    await syncFromDb();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function addTradingDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

function tradingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  while (d < to) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function rowToCatalystEntry(row: any): CatalystEntry {
  return {
    id: row.id,
    subject: row.subject,
    subjectKind: row.subject_kind,
    catalystType: row.catalyst_type,
    headline: row.headline,
    source: row.source,
    firedAt: String(row.fired_at),
    expiresAt: String(row.expires_at),
    initialReaction: row.initial_reaction,
    expectedDirection: row.expected_direction,
    decayWeight: Number(row.decay_weight),
    resolved: row.resolved,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    resolutionMagnitude: row.resolution_magnitude != null ? Number(row.resolution_magnitude) : null,
    ruleId: row.rule_id,
    ownerId: row.owner_id,
    notes: row.notes,
    createdAt: String(row.created_at),
  };
}

function rowToRule(row: any): CatalystRuleDefinition {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    catalystType: row.catalyst_type,
    description: row.description ?? "",
    windowDays: row.window_days,
    decayShape: row.decay_shape,
    boostMultiplier: Number(row.boost_multiplier),
    minNewsSeverity: row.min_news_severity,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    contraryThresholdPct: Number(row.contrary_threshold_pct),
    ownerId: row.owner_id,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
