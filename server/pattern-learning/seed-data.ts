import { db } from "../db";
import { 
  masterSetups, 
  setupVariants, 
  formationStages, 
  ratingCriteria,
  ratingWeights,
  InsertMasterSetup,
  InsertSetupVariant,
  InsertFormationStage,
  InsertRatingCriteria,
  InsertRatingWeight
} from "@shared/schema";
import { eq } from "drizzle-orm";

const MASTER_SETUPS_DATA: InsertMasterSetup[] = [
  {
    name: "Cup and Handle",
    description: "U-shaped base with a handle pullback before breakout",
    defaultStages: ["Cup Forming", "Cup Complete", "Handle Forming", "Handle Complete", "Ready", "Triggered", "Failed"],
    invalidationRules: { minCupDepthPct: 12, maxHandleDepthPct: 50 },
    isActive: true,
  },
  {
    name: "VCP",
    description: "Volatility Contraction Pattern with tightening price ranges",
    defaultStages: ["T1", "T2", "T3", "T4+", "Pivot Ready", "Triggered", "Failed"],
    invalidationRules: { minContractions: 2 },
    isActive: true,
  },
  {
    name: "High Tight Flag",
    description: "Strong run-up followed by tight consolidation",
    defaultStages: ["Run-Up", "Flag Forming", "Tight", "Ready", "Triggered", "Failed"],
    invalidationRules: { minRunUpPct: 25 },
    isActive: true,
  },
  {
    name: "Flat Base",
    description: "Tight horizontal consolidation pattern",
    defaultStages: ["Building", "Defined", "Tightening", "Ready", "Triggered", "Failed"],
    invalidationRules: { minBaseWeeks: 3 },
    isActive: true,
  },
  {
    name: "Double Bottom",
    description: "W-shaped pattern with two bottoms near same level",
    defaultStages: ["First Bottom", "Rally", "Second Bottom", "Confirmation", "Triggered", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Bull Flag",
    description: "Strong pole followed by flag consolidation",
    defaultStages: ["Pole", "Flag Forming", "Tight", "Ready", "Triggered", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Triangle",
    description: "Converging trendlines (ascending, descending, or symmetrical)",
    defaultStages: ["Forming", "Apex Approaching", "Ready", "Triggered", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "ORB",
    description: "Opening Range Breakout - intraday pattern",
    defaultStages: ["Range Setting", "Range Set", "Testing", "Breakout", "Confirmed", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Episodic Pivot",
    description: "Catalyst-driven breakout (earnings, FDA, news)",
    defaultStages: ["Anticipation", "Catalyst Event", "Reaction", "Follow-Through", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Pullback/Reclaim",
    description: "Breakout followed by pullback and reclaim",
    defaultStages: ["Initial Move", "Pullback", "Testing Support", "Reclaim", "Hold/Confirmed", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Gap and Go",
    description: "Gap up followed by continuation",
    defaultStages: ["Gap", "HOD Breakout", "Extension", "Consolidation", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Ascending Base",
    description: "Series of higher lows with resistance",
    defaultStages: ["First Low", "Higher Low 1", "Higher Low 2", "Testing Resistance", "Ready", "Triggered", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Consolidation Breakout",
    description: "Generic tight range breakout",
    defaultStages: ["Consolidating", "Tightening", "Ready", "Breakout", "Confirmed", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
  {
    name: "Failed Breakout",
    description: "Inverse setup - what happens after failure",
    defaultStages: ["Breakout Attempt", "Failure", "Shakeout", "Recovery", "Re-Test", "Failed"],
    invalidationRules: {},
    isActive: true,
  },
];

const VARIANT_CONFIGS = [
  { suffix: "Multi-Year", timeframe: "W", durationMin: "1 year", durationMax: "3 years", chartPeriod: "2y" },
  { suffix: "Multi-Month", timeframe: "D", durationMin: "3 months", durationMax: "12 months", chartPeriod: "1y" },
  { suffix: "Weekly", timeframe: "D", durationMin: "2 weeks", durationMax: "6 weeks", chartPeriod: "6mo" },
  { suffix: "Intraday", timeframe: "5", durationMin: "Hours", durationMax: "1 day", chartPeriod: "5d" },
];

const INTRADAY_ONLY_PATTERNS = ["ORB", "Gap and Go"];
const NO_INTRADAY_PATTERNS = ["Multi-Year"];

const UNIVERSAL_CRITERIA: Omit<InsertRatingCriteria, "masterSetupId">[] = [
  { category: "market_env", name: "SPY Trend Alignment", description: "Price above/below key moving averages", maxPoints: 5, isUniversal: true },
  { category: "market_env", name: "VIX Level", description: "Volatility environment (low vs elevated)", maxPoints: 4, isUniversal: true },
  { category: "market_env", name: "Sector Strength", description: "Sector performance vs market", maxPoints: 4, isUniversal: true },
  { category: "market_env", name: "Distribution Days", description: "Recent heavy selling sessions", maxPoints: 4, isUniversal: true },
  { category: "market_env", name: "Market Breadth", description: "Advance/decline line health", maxPoints: 3, isUniversal: true },
  
  { category: "relative_strength", name: "RS Line vs SPY", description: "Relative strength line trending", maxPoints: 5, isUniversal: true },
  { category: "relative_strength", name: "Sector RS", description: "Stock RS vs its sector", maxPoints: 4, isUniversal: true },
  { category: "relative_strength", name: "Vs Peers", description: "Performance vs direct competitors", maxPoints: 4, isUniversal: true },
  { category: "relative_strength", name: "RS Rating", description: "IBD-style RS rating", maxPoints: 4, isUniversal: true },
  { category: "relative_strength", name: "Momentum", description: "Recent price momentum strength", maxPoints: 3, isUniversal: true },
  
  { category: "volume_quality", name: "Above Avg Volume", description: "Volume above 50-day average", maxPoints: 5, isUniversal: true },
  { category: "volume_quality", name: "Accumulation Signs", description: "Up days on higher volume", maxPoints: 5, isUniversal: true },
  { category: "volume_quality", name: "Volume Dry-Up", description: "Low volume during consolidation", maxPoints: 4, isUniversal: true },
  { category: "volume_quality", name: "Breakout Volume", description: "Volume expansion on breakout", maxPoints: 3, isUniversal: true },
  { category: "volume_quality", name: "Institutional Activity", description: "Signs of institutional buying", maxPoints: 3, isUniversal: true },
  
  { category: "technical_structure", name: "MA Alignment", description: "21/50/200 MA alignment (stacked)", maxPoints: 5, isUniversal: true },
  { category: "technical_structure", name: "Distance from MAs", description: "Not extended from key MAs", maxPoints: 4, isUniversal: true },
  { category: "technical_structure", name: "Support/Resistance", description: "Clear S/R levels identified", maxPoints: 4, isUniversal: true },
  { category: "technical_structure", name: "Pivot Clarity", description: "Clear pivot point identified", maxPoints: 4, isUniversal: true },
  { category: "technical_structure", name: "Base Structure", description: "Clean base with few undercuts", maxPoints: 3, isUniversal: true },
];

const PATTERN_SPECIFIC_CRITERIA: Record<string, Omit<InsertRatingCriteria, "masterSetupId" | "isUniversal">[]> = {
  "Cup and Handle": [
    { category: "pattern_specific", name: "Cup Depth", description: "Cup depth 12-33% (ideal)", maxPoints: 5 },
    { category: "pattern_specific", name: "Handle Depth vs Cup", description: "Handle < 50% of cup depth", maxPoints: 5 },
    { category: "pattern_specific", name: "Cup Shape", description: "Smooth U-shape vs V-shape", maxPoints: 4 },
    { category: "pattern_specific", name: "Handle Duration", description: "1-4 weeks ideal", maxPoints: 3 },
    { category: "pattern_specific", name: "Handle Volume", description: "Volume dry-up in handle", maxPoints: 3 },
  ],
  "VCP": [
    { category: "pattern_specific", name: "Number of Contractions", description: "2-4 contractions ideal", maxPoints: 5 },
    { category: "pattern_specific", name: "Tightness Ratio", description: "Each contraction tighter than last", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume Contraction", description: "Volume decreasing with each T", maxPoints: 4 },
    { category: "pattern_specific", name: "Pivot Proximity", description: "Close to pivot point", maxPoints: 3 },
    { category: "pattern_specific", name: "Base Duration", description: "Appropriate base length", maxPoints: 3 },
  ],
  "High Tight Flag": [
    { category: "pattern_specific", name: "Initial Run-Up", description: "25%+ gain before flag", maxPoints: 5 },
    { category: "pattern_specific", name: "Flag Depth", description: "Shallow consolidation (10-20%)", maxPoints: 5 },
    { category: "pattern_specific", name: "Flag Duration", description: "4-8 weeks ideal", maxPoints: 4 },
    { category: "pattern_specific", name: "Flag Tightness", description: "Tight price range", maxPoints: 3 },
    { category: "pattern_specific", name: "Volume Pattern", description: "Low volume in flag", maxPoints: 3 },
  ],
  "Flat Base": [
    { category: "pattern_specific", name: "Base Tightness", description: "Price range < 15%", maxPoints: 5 },
    { category: "pattern_specific", name: "Base Duration", description: "5-7 weeks ideal", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume Signature", description: "Quiet volume during base", maxPoints: 4 },
    { category: "pattern_specific", name: "Prior Move", description: "Strong prior uptrend", maxPoints: 3 },
    { category: "pattern_specific", name: "Pivot Clarity", description: "Clear breakout level", maxPoints: 3 },
  ],
  "Double Bottom": [
    { category: "pattern_specific", name: "Bottom Alignment", description: "Bottoms at similar levels", maxPoints: 5 },
    { category: "pattern_specific", name: "Middle Rally", description: "Rally between bottoms", maxPoints: 5 },
    { category: "pattern_specific", name: "Second Bottom Volume", description: "Lower volume on 2nd", maxPoints: 4 },
    { category: "pattern_specific", name: "Time Between", description: "Weeks between bottoms", maxPoints: 3 },
    { category: "pattern_specific", name: "Confirmation", description: "Break above middle peak", maxPoints: 3 },
  ],
  "Bull Flag": [
    { category: "pattern_specific", name: "Pole Strength", description: "Strong prior run-up", maxPoints: 5 },
    { category: "pattern_specific", name: "Flag Slope", description: "Slight downward drift", maxPoints: 5 },
    { category: "pattern_specific", name: "Flag Volume", description: "Decreasing volume", maxPoints: 4 },
    { category: "pattern_specific", name: "Flag Duration", description: "1-3 weeks ideal", maxPoints: 3 },
    { category: "pattern_specific", name: "Breakout Quality", description: "Volume on breakout", maxPoints: 3 },
  ],
  "Triangle": [
    { category: "pattern_specific", name: "Touch Count", description: "3+ touches per line", maxPoints: 5 },
    { category: "pattern_specific", name: "Apex Tightness", description: "Converging trendlines", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume Pattern", description: "Decreasing volume", maxPoints: 4 },
    { category: "pattern_specific", name: "Pattern Type", description: "Ascending/Descending/Sym", maxPoints: 3 },
    { category: "pattern_specific", name: "Breakout Timing", description: "Before apex reached", maxPoints: 3 },
  ],
  "ORB": [
    { category: "pattern_specific", name: "Range Tightness", description: "Tight opening range", maxPoints: 5 },
    { category: "pattern_specific", name: "Pre-market Gap", description: "Gap size and direction", maxPoints: 5 },
    { category: "pattern_specific", name: "Relative Volume", description: "Volume vs average at open", maxPoints: 4 },
    { category: "pattern_specific", name: "Catalyst Quality", description: "News or earnings catalyst", maxPoints: 3 },
    { category: "pattern_specific", name: "Time of Breakout", description: "First 30 mins vs later", maxPoints: 3 },
  ],
  "Episodic Pivot": [
    { category: "pattern_specific", name: "Catalyst Type", description: "Earnings/FDA/News quality", maxPoints: 5 },
    { category: "pattern_specific", name: "Gap Size", description: "Meaningful gap on news", maxPoints: 5 },
    { category: "pattern_specific", name: "Setup Quality", description: "Base before catalyst", maxPoints: 4 },
    { category: "pattern_specific", name: "Sector Sympathy", description: "Related stocks moving", maxPoints: 3 },
    { category: "pattern_specific", name: "Follow-Through", description: "Days after catalyst", maxPoints: 3 },
  ],
  "Pullback/Reclaim": [
    { category: "pattern_specific", name: "Pullback Depth", description: "Shallow pullback %", maxPoints: 5 },
    { category: "pattern_specific", name: "MA Significance", description: "Testing key MA (21/50)", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume on Reclaim", description: "Strong volume return", maxPoints: 4 },
    { category: "pattern_specific", name: "Hold Duration", description: "Holding above MA", maxPoints: 3 },
    { category: "pattern_specific", name: "Prior Breakout", description: "Quality of initial move", maxPoints: 3 },
  ],
  "Gap and Go": [
    { category: "pattern_specific", name: "Gap Size", description: "Gap percentage", maxPoints: 5 },
    { category: "pattern_specific", name: "Pre-market Volume", description: "Volume in pre-market", maxPoints: 5 },
    { category: "pattern_specific", name: "Float", description: "Low float preferred", maxPoints: 4 },
    { category: "pattern_specific", name: "News Catalyst", description: "Reason for gap", maxPoints: 3 },
    { category: "pattern_specific", name: "HOD Break", description: "Breaking high of day", maxPoints: 3 },
  ],
  "Ascending Base": [
    { category: "pattern_specific", name: "Higher Lows", description: "Clear higher low pattern", maxPoints: 5 },
    { category: "pattern_specific", name: "Resistance Tests", description: "Multiple resistance tests", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume Pattern", description: "Up on volume, down on light", maxPoints: 4 },
    { category: "pattern_specific", name: "Time Frame", description: "Weeks to form", maxPoints: 3 },
    { category: "pattern_specific", name: "Tightness", description: "Narrowing range", maxPoints: 3 },
  ],
  "Consolidation Breakout": [
    { category: "pattern_specific", name: "Range Tightness", description: "Tight price range", maxPoints: 5 },
    { category: "pattern_specific", name: "Duration", description: "Appropriate consolidation time", maxPoints: 5 },
    { category: "pattern_specific", name: "Volume Dry-Up", description: "Low volume in range", maxPoints: 4 },
    { category: "pattern_specific", name: "Prior Trend", description: "Strong prior move", maxPoints: 3 },
    { category: "pattern_specific", name: "Pivot Clarity", description: "Clear breakout level", maxPoints: 3 },
  ],
  "Failed Breakout": [
    { category: "pattern_specific", name: "Initial Setup Quality", description: "Was original setup good", maxPoints: 5 },
    { category: "pattern_specific", name: "Failure Depth", description: "How far below pivot", maxPoints: 5 },
    { category: "pattern_specific", name: "Shakeout Volume", description: "Volume on failure", maxPoints: 4 },
    { category: "pattern_specific", name: "Recovery Speed", description: "How fast recovery", maxPoints: 3 },
    { category: "pattern_specific", name: "Re-Test Quality", description: "Quality of re-attempt", maxPoints: 3 },
  ],
};

const STAGE_DURATIONS: Record<string, Record<string, { min: string; max: string; tooLong: string }>> = {
  "Cup and Handle": {
    "Cup Forming": { min: "6 weeks", max: "52 weeks", tooLong: "18 months" },
    "Handle Forming": { min: "1 week", max: "4 weeks", tooLong: "8 weeks" },
  },
  "VCP": {
    "T1": { min: "1 week", max: "4 weeks", tooLong: "8 weeks" },
    "T2": { min: "1 week", max: "3 weeks", tooLong: "6 weeks" },
    "T3": { min: "1 week", max: "2 weeks", tooLong: "4 weeks" },
  },
  "ORB": {
    "Range Setting": { min: "5 min", max: "30 min", tooLong: "1 hour" },
    "Range Set": { min: "5 min", max: "15 min", tooLong: "30 min" },
  },
};

export async function seedPatternLearningV2() {
  console.log("[Seed] Starting Pattern Learning V2 seed...");
  
  if (!db) {
    console.log("[Seed] Database not available, skipping seed");
    return;
  }
  
  const existingSetups = await db.select().from(masterSetups).limit(1);
  if (existingSetups.length > 0) {
    console.log("[Seed] Master setups already exist, skipping seed");
    return;
  }
  
  const insertedSetups = await db.insert(masterSetups).values(MASTER_SETUPS_DATA).returning();
  console.log(`[Seed] Inserted ${insertedSetups.length} master setups`);
  
  const setupMap = new Map(insertedSetups.map(s => [s.name, s.id]));
  
  const variantsToInsert: InsertSetupVariant[] = [];
  for (const setup of insertedSetups) {
    for (const config of VARIANT_CONFIGS) {
      if (INTRADAY_ONLY_PATTERNS.includes(setup.name) && config.suffix !== "Intraday") {
        continue;
      }
      if (config.suffix === "Multi-Year" && INTRADAY_ONLY_PATTERNS.includes(setup.name)) {
        continue;
      }
      variantsToInsert.push({
        masterSetupId: setup.id,
        name: `${config.suffix} ${setup.name}`,
        timeframe: config.timeframe,
        durationMin: config.durationMin,
        durationMax: config.durationMax,
        chartPeriod: config.chartPeriod,
        isActive: true,
      });
    }
  }
  
  const insertedVariants = await db.insert(setupVariants).values(variantsToInsert).returning();
  console.log(`[Seed] Inserted ${insertedVariants.length} setup variants`);
  
  const stagesToInsert: InsertFormationStage[] = [];
  for (const setup of insertedSetups) {
    const stages = setup.defaultStages as string[] || [];
    const setupDurations = STAGE_DURATIONS[setup.name] || {};
    stages.forEach((stageName, index) => {
      const isTerminal = stageName === "Failed" || stageName === "Triggered";
      const scoreModifier = stageName === "Failed" ? -20 : stageName === "Triggered" ? 5 : 0;
      const duration = setupDurations[stageName];
      stagesToInsert.push({
        masterSetupId: setup.id,
        stageName,
        stageOrder: index + 1,
        stageType: isTerminal ? "terminal" : "sequential",
        isTerminal,
        scoreModifier,
        typicalDurationMin: duration?.min || null,
        typicalDurationMax: duration?.max || null,
        tooLongThreshold: duration?.tooLong || null,
        description: null,
      });
    });
  }
  
  await db.insert(formationStages).values(stagesToInsert);
  console.log(`[Seed] Inserted ${stagesToInsert.length} formation stages`);
  
  const universalCriteriaToInsert: InsertRatingCriteria[] = UNIVERSAL_CRITERIA.map(c => ({
    ...c,
    masterSetupId: null,
  }));
  
  await db.insert(ratingCriteria).values(universalCriteriaToInsert);
  console.log(`[Seed] Inserted ${universalCriteriaToInsert.length} universal criteria`);
  
  let patternCriteriaCount = 0;
  const patternCriteriaMap = new Map<number, number[]>();
  
  for (const [patternName, criteria] of Object.entries(PATTERN_SPECIFIC_CRITERIA)) {
    const setupId = setupMap.get(patternName);
    if (setupId) {
      const criteriaToInsert: InsertRatingCriteria[] = criteria.map(c => ({
        ...c,
        masterSetupId: setupId,
        isUniversal: false,
      }));
      const inserted = await db.insert(ratingCriteria).values(criteriaToInsert).returning();
      patternCriteriaMap.set(setupId, inserted.map(c => c.id));
      patternCriteriaCount += inserted.length;
    }
  }
  console.log(`[Seed] Inserted ${patternCriteriaCount} pattern-specific criteria`);
  
  const allCriteria = await db.select().from(ratingCriteria);
  const universalCriteriaIds = allCriteria.filter(c => c.isUniversal).map(c => c.id);
  
  const weightsToInsert: InsertRatingWeight[] = [];
  for (const variant of insertedVariants) {
    const patternCriteriaIds = patternCriteriaMap.get(variant.masterSetupId) || [];
    const relevantCriteriaIds = [...universalCriteriaIds, ...patternCriteriaIds];
    
    for (const criteriaId of relevantCriteriaIds) {
      weightsToInsert.push({
        setupVariantId: variant.id,
        criteriaId,
        defaultWeight: 1.0,
        weight: 1.0,
        userId: null,
        isDefault: true,
      });
    }
  }
  
  if (weightsToInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < weightsToInsert.length; i += batchSize) {
      const batch = weightsToInsert.slice(i, i + batchSize);
      await db.insert(ratingWeights).values(batch);
    }
  }
  console.log(`[Seed] Inserted ${weightsToInsert.length} rating weights`);
  
  console.log("[Seed] Pattern Learning V2 seed complete!");
}
