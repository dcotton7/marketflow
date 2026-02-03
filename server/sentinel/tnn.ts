import { db } from "../db";
import { tnnFactors, tnnModifiers, tnnSuggestions, tnnHistory, tnnSettings } from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";

// === SEED DATA ===

// Discipline Factors (12 categories from rule system)
const DISCIPLINE_FACTORS = [
  { factorKey: "structural", factorName: "Structural Requirements", description: "Core structural requirements that must be met", baseWeight: 90, order: 1 },
  { factorKey: "entry", factorName: "Entry Timing", description: "Quality of entry timing and execution", baseWeight: 75, order: 2 },
  { factorKey: "exit", factorName: "Exit Execution", description: "Discipline in exit execution", baseWeight: 70, order: 3 },
  { factorKey: "profit_taking", factorName: "Profit Taking", description: "Skill in taking profits at appropriate levels", baseWeight: 65, order: 4 },
  { factorKey: "stop_loss", factorName: "Stop Loss Discipline", description: "Adherence to stop loss rules", baseWeight: 85, order: 5 },
  { factorKey: "ma_structure", factorName: "MA Structure", description: "Moving average structure quality", baseWeight: 70, order: 6 },
  { factorKey: "base_quality", factorName: "Base Quality", description: "Quality of the base/consolidation pattern", baseWeight: 75, order: 7 },
  { factorKey: "breakout", factorName: "Breakout Quality", description: "Quality of breakout characteristics", baseWeight: 75, order: 8 },
  { factorKey: "position_sizing", factorName: "Position Sizing", description: "Appropriate position sizing relative to risk", baseWeight: 80, order: 9 },
  { factorKey: "market_regime", factorName: "Market Regime Alignment", description: "Alignment with current market environment", baseWeight: 70, order: 10 },
  { factorKey: "risk", factorName: "Risk Management", description: "Overall risk management discipline", baseWeight: 85, order: 11 },
  { factorKey: "general", factorName: "General Discipline", description: "General trading discipline factors", baseWeight: 60, order: 12 },
];

// Setup Type Factors (from AI model tags and user selection)
const SETUP_TYPE_FACTORS = [
  { factorKey: "breakout", factorName: "Breakout Setup", description: "Traditional breakout from consolidation or base", baseWeight: 75, order: 1 },
  { factorKey: "pullback", factorName: "Pullback Setup", description: "Pullback to moving average support (21/50 EMA)", baseWeight: 70, order: 2 },
  { factorKey: "reclaim", factorName: "Reclaim Setup", description: "Reclaim of key level after breakdown", baseWeight: 65, order: 3 },
  { factorKey: "cup_and_handle", factorName: "Cup & Handle", description: "Classic cup and handle pattern", baseWeight: 80, order: 4 },
  { factorKey: "episodic_pivot", factorName: "Episodic Pivot", description: "Gap up on earnings or news catalyst", baseWeight: 70, order: 5 },
  { factorKey: "high_tight_flag", factorName: "High Tight Flag", description: "Tight consolidation after strong move", baseWeight: 75, order: 6 },
  { factorKey: "vcp", factorName: "VCP (Volatility Contraction)", description: "Volatility contraction pattern", baseWeight: 75, order: 7 },
  { factorKey: "low_cheat", factorName: "Low Cheat Setup", description: "Buy before official breakout/pivot point", baseWeight: 70, order: 8 },
  { factorKey: "undercut_rally", factorName: "Undercut & Rally", description: "Break below support then reclaim with strength", baseWeight: 65, order: 9 },
  { factorKey: "orb", factorName: "Opening Range Breakout", description: "Breakout of first 15-30min range", baseWeight: 60, order: 10 },
  { factorKey: "short_lost_50", factorName: "SHORT: Lost 50 SMA", description: "Short position after stock loses 50-day moving average", baseWeight: 70, order: 11 },
  { factorKey: "short_lost_200", factorName: "SHORT: Lost 200 SMA", description: "Short position after stock loses 200-day moving average", baseWeight: 75, order: 12 },
  { factorKey: "other", factorName: "Other Setup", description: "Custom or unclassified setup type", baseWeight: 50, order: 13 },
];

// Baseline Modifiers (setup × market condition) - manual admin defaults
const BASELINE_MODIFIERS = [
  // Pullback modifiers
  { factorKey: "pullback", factorName: "Pullback Setup", whenCondition: "choppy_daily", whenConditionName: "Choppy Daily Market", weightModifier: 15, notes: "Pullbacks to MAs tend to work better in choppy conditions" },
  { factorKey: "pullback", factorName: "Pullback Setup", whenCondition: "trending_weekly", whenConditionName: "Trending Weekly Market", weightModifier: 10, notes: "Pullbacks in uptrending markets are higher probability" },
  { factorKey: "pullback", factorName: "Pullback Setup", whenCondition: "risk_off", whenConditionName: "Risk-Off Environment", weightModifier: -10, notes: "Pullbacks less reliable in risk-off" },
  
  // Breakout modifiers
  { factorKey: "breakout", factorName: "Breakout Setup", whenCondition: "choppy_daily", whenConditionName: "Choppy Daily Market", weightModifier: -20, notes: "Breakouts fail more often in choppy conditions" },
  { factorKey: "breakout", factorName: "Breakout Setup", whenCondition: "choppy_weekly", whenConditionName: "Choppy Weekly Market", weightModifier: -25, notes: "Weekly chop kills breakouts" },
  { factorKey: "breakout", factorName: "Breakout Setup", whenCondition: "trending_weekly", whenConditionName: "Trending Weekly Market", weightModifier: 15, notes: "Breakouts thrive in trending markets" },
  { factorKey: "breakout", factorName: "Breakout Setup", whenCondition: "risk_on", whenConditionName: "Risk-On Environment", weightModifier: 10, notes: "Risk-on favors breakouts" },
  
  // Reclaim modifiers
  { factorKey: "reclaim", factorName: "Reclaim Setup", whenCondition: "oversold_market", whenConditionName: "Oversold Market Conditions", weightModifier: 15, notes: "Reclaims work better in oversold bounces" },
  { factorKey: "reclaim", factorName: "Reclaim Setup", whenCondition: "risk_off", whenConditionName: "Risk-Off Environment", weightModifier: -15, notes: "Reclaims struggle in risk-off" },
  
  // Cup & Handle modifiers
  { factorKey: "cup_and_handle", factorName: "Cup & Handle", whenCondition: "trending_weekly", whenConditionName: "Trending Weekly Market", weightModifier: 15, notes: "C&H is a trend continuation pattern" },
  { factorKey: "cup_and_handle", factorName: "Cup & Handle", whenCondition: "choppy_weekly", whenConditionName: "Choppy Weekly Market", weightModifier: -10, notes: "C&H less effective without clear trend" },
  
  // Episodic Pivot modifiers
  { factorKey: "episodic_pivot", factorName: "Episodic Pivot", whenCondition: "risk_on", whenConditionName: "Risk-On Environment", weightModifier: 10, notes: "EPs work better with market support" },
  { factorKey: "episodic_pivot", factorName: "Episodic Pivot", whenCondition: "volatility_stress", whenConditionName: "High Volatility/VIX Stress", weightModifier: -10, notes: "EPs get chopped up in volatile markets" },
  
  // ORB modifiers
  { factorKey: "orb", factorName: "Opening Range Breakout", whenCondition: "trending_daily", whenConditionName: "Trending Daily Market", weightModifier: 10, notes: "ORB works better on trend days" },
  { factorKey: "orb", factorName: "Opening Range Breakout", whenCondition: "choppy_daily", whenConditionName: "Choppy Daily Market", weightModifier: -15, notes: "ORB chops in range-bound markets" },
  
  // Short setup modifiers
  { factorKey: "short_lost_50", factorName: "SHORT: Lost 50 SMA", whenCondition: "risk_off", whenConditionName: "Risk-Off Environment", weightModifier: 15, notes: "Shorts work better in risk-off" },
  { factorKey: "short_lost_200", factorName: "SHORT: Lost 200 SMA", whenCondition: "risk_off", whenConditionName: "Risk-Off Environment", weightModifier: 20, notes: "Major breakdown shorts thrive in bear markets" },
];

// Default TNN Settings
const DEFAULT_SETTINGS = [
  { settingKey: "global_approval_mode", settingValue: "require_all", description: "Require admin approval for all AI changes" },
  { settingKey: "confidence_threshold", settingValue: "75", description: "Minimum AI confidence to show suggestions (0-100)" },
  { settingKey: "auto_apply_threshold", settingValue: "90", description: "Confidence level for auto-apply on unlocked factors (0-100)" },
  { settingKey: "min_sample_size", settingValue: "10", description: "Minimum trades required before AI suggests weight changes" },
  { settingKey: "suggestion_expiry_days", settingValue: "30", description: "Days before pending suggestions expire" },
  { settingKey: "last_ai_analysis", settingValue: "", description: "Timestamp of last AI analysis run" },
];

// === SEED FUNCTION ===

export async function seedTnnData() {
  // Check if already seeded
  const existingFactors = await db.select().from(tnnFactors).limit(1);
  if (existingFactors.length > 0) {
    console.log("TNN data already seeded, skipping...");
    return { seeded: false, message: "Already seeded" };
  }

  console.log("Seeding TNN data...");

  // Seed Discipline Factors
  for (const factor of DISCIPLINE_FACTORS) {
    await db.insert(tnnFactors).values({
      factorType: "discipline",
      factorKey: factor.factorKey,
      factorName: factor.factorName,
      description: factor.description,
      category: factor.factorKey,
      baseWeight: factor.baseWeight,
      aiAdjustedWeight: factor.baseWeight,
      order: factor.order,
    });
  }

  // Seed Setup Type Factors
  for (const factor of SETUP_TYPE_FACTORS) {
    await db.insert(tnnFactors).values({
      factorType: "setup_type",
      factorKey: factor.factorKey,
      factorName: factor.factorName,
      description: factor.description,
      baseWeight: factor.baseWeight,
      aiAdjustedWeight: factor.baseWeight,
      order: factor.order,
    });
  }

  // Seed Baseline Modifiers
  for (const mod of BASELINE_MODIFIERS) {
    await db.insert(tnnModifiers).values({
      factorKey: mod.factorKey,
      factorName: mod.factorName,
      whenCondition: mod.whenCondition,
      whenConditionName: mod.whenConditionName,
      weightModifier: mod.weightModifier,
      source: "manual",
      createdBy: "admin",
      notes: mod.notes,
    });
  }

  // Seed Default Settings
  for (const setting of DEFAULT_SETTINGS) {
    await db.insert(tnnSettings).values({
      settingKey: setting.settingKey,
      settingValue: setting.settingValue,
      description: setting.description,
    });
  }

  // Log initial setup in history
  await db.insert(tnnHistory).values({
    changeType: "settings",
    factorName: "TNN System",
    newValue: "initialized",
    changedBy: "system",
    reason: "Initial TNN system setup with default factors and modifiers",
  });

  console.log("TNN data seeded successfully!");
  return { seeded: true, message: "TNN data seeded with " + DISCIPLINE_FACTORS.length + " discipline factors, " + SETUP_TYPE_FACTORS.length + " setup type factors, and " + BASELINE_MODIFIERS.length + " baseline modifiers" };
}

// === CRUD OPERATIONS ===

// Get all factors with optional filtering
export async function getFactors(factorType?: string) {
  if (factorType) {
    return db.select().from(tnnFactors).where(eq(tnnFactors.factorType, factorType)).orderBy(asc(tnnFactors.order));
  }
  return db.select().from(tnnFactors).orderBy(asc(tnnFactors.factorType), asc(tnnFactors.order));
}

// Update factor weights
export async function updateFactor(factorKey: string, updates: {
  baseWeight?: number;
  aiAdjustedWeight?: number;
  autoAdjust?: boolean;
  maxMagnitude?: number | null;
  maxDrift?: number | null;
}, changedBy: string, reason?: string) {
  const existing = await db.select().from(tnnFactors).where(eq(tnnFactors.factorKey, factorKey)).limit(1);
  if (existing.length === 0) throw new Error("Factor not found");

  const oldFactor = existing[0];
  const changes: string[] = [];
  
  if (updates.baseWeight !== undefined && updates.baseWeight !== oldFactor.baseWeight) {
    changes.push(`baseWeight: ${oldFactor.baseWeight} → ${updates.baseWeight}`);
  }
  if (updates.aiAdjustedWeight !== undefined && updates.aiAdjustedWeight !== oldFactor.aiAdjustedWeight) {
    changes.push(`aiWeight: ${oldFactor.aiAdjustedWeight} → ${updates.aiAdjustedWeight}`);
  }
  if (updates.autoAdjust !== undefined && updates.autoAdjust !== oldFactor.autoAdjust) {
    changes.push(`autoAdjust: ${oldFactor.autoAdjust} → ${updates.autoAdjust}`);
  }

  const result = await db.update(tnnFactors)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(tnnFactors.factorKey, factorKey))
    .returning();

  // Log change if any updates were made
  if (changes.length > 0) {
    await db.insert(tnnHistory).values({
      changeType: "factor_weight",
      factorKey: factorKey,
      factorName: oldFactor.factorName,
      oldValue: JSON.stringify({ baseWeight: oldFactor.baseWeight, aiAdjustedWeight: oldFactor.aiAdjustedWeight, autoAdjust: oldFactor.autoAdjust }),
      newValue: JSON.stringify(updates),
      changedBy,
      reason: reason || changes.join(", "),
    });
  }

  return result[0];
}

// Get all modifiers with optional filtering
export async function getModifiers(factorKey?: string) {
  if (factorKey) {
    return db.select().from(tnnModifiers).where(eq(tnnModifiers.factorKey, factorKey)).orderBy(desc(tnnModifiers.createdAt));
  }
  return db.select().from(tnnModifiers).orderBy(asc(tnnModifiers.factorKey), desc(tnnModifiers.createdAt));
}

// Create a new modifier
export async function createModifier(data: {
  factorKey: string;
  factorName: string;
  whenCondition: string;
  whenConditionName: string;
  weightModifier: number;
  notes?: string;
}, createdBy: string) {
  const result = await db.insert(tnnModifiers).values({
    ...data,
    source: "manual",
    createdBy,
  }).returning();

  await db.insert(tnnHistory).values({
    changeType: "modifier_add",
    factorKey: data.factorKey,
    factorName: data.factorName,
    newValue: `${data.whenConditionName}: ${data.weightModifier > 0 ? '+' : ''}${data.weightModifier}`,
    changedBy: createdBy,
    reason: data.notes || "Manual modifier created",
  });

  return result[0];
}

// Update modifier
export async function updateModifier(id: number, updates: {
  weightModifier?: number;
  isActive?: boolean;
  notes?: string;
}, changedBy: string) {
  const existing = await db.select().from(tnnModifiers).where(eq(tnnModifiers.id, id)).limit(1);
  if (existing.length === 0) throw new Error("Modifier not found");

  const oldMod = existing[0];
  const result = await db.update(tnnModifiers)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(tnnModifiers.id, id))
    .returning();

  await db.insert(tnnHistory).values({
    changeType: "modifier_update",
    factorKey: oldMod.factorKey,
    factorName: oldMod.factorName,
    oldValue: `${oldMod.whenConditionName}: ${oldMod.weightModifier}`,
    newValue: updates.weightModifier !== undefined ? `${oldMod.whenConditionName}: ${updates.weightModifier}` : undefined,
    changedBy,
    reason: updates.notes || "Modifier updated",
  });

  return result[0];
}

// Delete modifier
export async function deleteModifier(id: number, changedBy: string) {
  const existing = await db.select().from(tnnModifiers).where(eq(tnnModifiers.id, id)).limit(1);
  if (existing.length === 0) throw new Error("Modifier not found");

  const oldMod = existing[0];
  await db.delete(tnnModifiers).where(eq(tnnModifiers.id, id));

  await db.insert(tnnHistory).values({
    changeType: "modifier_update",
    factorKey: oldMod.factorKey,
    factorName: oldMod.factorName,
    oldValue: `${oldMod.whenConditionName}: ${oldMod.weightModifier}`,
    newValue: "deleted",
    changedBy,
    reason: "Modifier deleted",
  });

  return { deleted: true };
}

// Get pending suggestions
export async function getSuggestions(status?: string) {
  if (status) {
    return db.select().from(tnnSuggestions).where(eq(tnnSuggestions.status, status)).orderBy(desc(tnnSuggestions.createdAt));
  }
  return db.select().from(tnnSuggestions).orderBy(desc(tnnSuggestions.createdAt));
}

// Approve or reject suggestion
export async function reviewSuggestion(id: number, approved: boolean, reviewedBy: number, notes?: string) {
  const existing = await db.select().from(tnnSuggestions).where(eq(tnnSuggestions.id, id)).limit(1);
  if (existing.length === 0) throw new Error("Suggestion not found");

  const suggestion = existing[0];
  const status = approved ? "approved" : "rejected";

  const result = await db.update(tnnSuggestions)
    .set({ status, reviewedBy, reviewedAt: new Date(), reviewNotes: notes })
    .where(eq(tnnSuggestions.id, id))
    .returning();

  // If approved, apply the change
  if (approved) {
    if (suggestion.suggestionType === "factor_weight") {
      await updateFactor(suggestion.factorKey, { aiAdjustedWeight: suggestion.proposedValue }, "ai", suggestion.reasoning);
    } else if (suggestion.suggestionType === "modifier" && suggestion.whenCondition) {
      // Check if modifier exists, update or create
      const existingMod = await db.select().from(tnnModifiers)
        .where(and(
          eq(tnnModifiers.factorKey, suggestion.factorKey),
          eq(tnnModifiers.whenCondition, suggestion.whenCondition)
        )).limit(1);

      if (existingMod.length > 0) {
        await updateModifier(existingMod[0].id, { weightModifier: suggestion.proposedValue }, "ai");
        // Update source to ai_confirmed
        await db.update(tnnModifiers)
          .set({ source: "ai_confirmed" })
          .where(eq(tnnModifiers.id, existingMod[0].id));
      } else {
        await createModifier({
          factorKey: suggestion.factorKey,
          factorName: suggestion.factorName,
          whenCondition: suggestion.whenCondition,
          whenConditionName: suggestion.whenConditionName || "",
          weightModifier: suggestion.proposedValue,
          notes: suggestion.reasoning,
        }, "ai");
      }
    }
  }

  return result[0];
}

// Get history
export async function getHistory(limit: number = 50) {
  return db.select().from(tnnHistory).orderBy(desc(tnnHistory.createdAt)).limit(limit);
}

// Get/set settings
export async function getSetting(key: string) {
  const result = await db.select().from(tnnSettings).where(eq(tnnSettings.settingKey, key)).limit(1);
  return result.length > 0 ? result[0].settingValue : null;
}

export async function getSettings() {
  return db.select().from(tnnSettings);
}

export async function updateSetting(key: string, value: string, changedBy: string) {
  const existing = await db.select().from(tnnSettings).where(eq(tnnSettings.settingKey, key)).limit(1);
  
  if (existing.length > 0) {
    const oldValue = existing[0].settingValue;
    await db.update(tnnSettings)
      .set({ settingValue: value, updatedAt: new Date() })
      .where(eq(tnnSettings.settingKey, key));
    
    await db.insert(tnnHistory).values({
      changeType: "settings",
      factorName: key,
      oldValue,
      newValue: value,
      changedBy,
      reason: `Setting "${key}" updated`,
    });
  } else {
    await db.insert(tnnSettings).values({ settingKey: key, settingValue: value });
  }

  return { key, value };
}

// === WEIGHT CALCULATION FOR AI EVALUATION ===

export interface TnnWeightContext {
  factors: { [key: string]: number };
  modifiers: { factorKey: string; condition: string; modifier: number }[];
  activeConditions: string[];
}

export async function getWeightsForEvaluation(setupType: string, activeConditions: string[]): Promise<TnnWeightContext> {
  const allFactors = await getFactors();
  const allModifiers = await getModifiers();

  // Build factors map with current weights
  const factors: { [key: string]: number } = {};
  for (const f of allFactors) {
    factors[f.factorKey] = f.aiAdjustedWeight ?? f.baseWeight;
  }

  // Find applicable modifiers for the setup type and conditions
  const applicableModifiers = allModifiers.filter(m => 
    m.isActive && 
    (m.factorKey === setupType || m.factorKey.includes("setup")) &&
    activeConditions.includes(m.whenCondition)
  );

  // Apply modifiers to weights
  for (const mod of applicableModifiers) {
    if (factors[mod.factorKey] !== undefined) {
      factors[mod.factorKey] = Math.max(0, Math.min(100, factors[mod.factorKey] + mod.weightModifier));
    }
  }

  return {
    factors,
    modifiers: applicableModifiers.map(m => ({
      factorKey: m.factorKey,
      condition: m.whenCondition,
      modifier: m.weightModifier,
    })),
    activeConditions,
  };
}
