export type SetupType = 
  | 'breakout' 
  | 'pullback' 
  | 'cup_and_handle' 
  | 'vcp' 
  | 'episodic_pivot' 
  | 'reclaim' 
  | 'high_tight_flag'
  | 'low_cheat'
  | 'undercut_rally'
  | 'orb'
  | 'short_lost_50'
  | 'short_lost_200'
  | 'other';

export interface EvaluationRequest {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopPrice?: number;
  stopPriceLevel?: string;
  targetPrice?: number; // First profit trim
  targetPriceLevel?: string; // First profit trim level
  targetProfitPrice?: number; // Full position exit target
  targetProfitLevel?: string; // Full target level: EXTENDED_8X_50DMA, PREV_HIGH, RR_5X, etc.
  positionSize?: number;
  positionSizeUnit?: 'shares' | 'dollars';
  thesis?: string;
  setupType?: SetupType; // Explicit setup pattern selection
  deepEval?: boolean;
  historicalAnalysis?: boolean; // Reviewing a past trade vs. evaluating a new one
  tradeDate?: string; // ISO date string for historical trades (YYYY-MM-DD)
  tradeTime?: string; // Time of trade for historical analysis (HH:MM)
}

export interface RiskFlagDetail {
  flag: string;
  severity: 'high' | 'medium' | 'low';
  tier?: 'fatal' | 'contextual' | 'missing_input';
  detail: string;
}

export interface RuleCheckItem {
  rule: string;
  status: 'followed' | 'violated' | 'na';
  note?: string;
}

export interface PlanSummary {
  entry: string;
  stop: string;
  riskPerShare: string;
  firstTrim?: string | null;
  target: string | null;
  rrRatio: string | null;
}

export interface VerdictSummary {
  verdict: string;
  primaryBlockers: string[];
}

export interface MoneyBreakdown {
  totalRisk: string;
  riskPerShare: string;
  firstTrimProfit: string | null;
  firstTrimProfitPerShare: string | null;
  targetProfit: string | null;
  targetProfitPerShare: string | null;
  totalPotentialProfit: string;
}

export interface EvaluationResult {
  // Core decision gate
  score: number;
  status: 'GREEN' | 'YELLOW' | 'NEEDS_PLAN' | 'RED';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  modelTag: 'BREAKOUT' | 'RECLAIM' | 'CUP_AND_HANDLE' | 'PULLBACK' | 'EPISODIC_PIVOT' | 'UNKNOWN';
  instrumentType?: 'ETF' | 'STOCK' | 'INDEX';
  
  // Verdict summary - primary blockers at top
  verdictSummary?: VerdictSummary;
  
  // Money breakdown - real dollars
  moneyBreakdown?: MoneyBreakdown;
  
  // User's plan summary
  planSummary: PlanSummary;
  
  tradeSnapshot?: {
    good: string[];
    bad: string[];
  };
  logicalStops?: {
    userStopEval: string;
    suggestions: Array<{
      price: number;
      label: string;
      distancePercent: number;
      reasoning: string;
      rank: number;
    }>;
  };
  logicalTargets?: {
    userTargetEval: string;
    ruleCompliance?: string;
    suggestions: Array<{
      price: number;
      label: string;
      distancePercent: number;
      rrRatio?: string;
      meetsRules?: string;
      reasoning: string;
    }>;
    partialProfitIdea: string | null;
  };
  whyBullets: string[];
  riskFlags: RiskFlagDetail[];
  improvements: string[];
  fixesToPass?: string[];
  ruleChecklist: RuleCheckItem[];
  
  // Process analysis for historical trades
  processAnalysis?: {
    entryExecution: string;
    stopManagement: string;
    targetManagement: string;
    emotionalControl: string;
    rulesFollowed: number;
    rulesViolated: number;
  };
  
  // Legacy fields for backwards compatibility
  recommendation: 'proceed' | 'caution' | 'avoid';
  reasoning: string;
  model: string;
  promptVersion: string;
}

export interface TradeUpdate {
  stopPrice?: number;
  partialPrice?: number;
  targetPrice?: number;
  entryPrice?: number;
  entryDate?: string;
  exitPrice?: number;
  positionSize?: number;
  status?: 'considering' | 'active' | 'closed';
}

export interface DashboardData {
  considering: TradeWithEvaluation[];
  active: TradeWithEvaluation[];
  closed: TradeWithEvaluation[];
  recentEvents: EventWithTrade[];
}

export interface TradeWithEvaluation {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopPrice: number | null;
  partialPrice: number | null;
  targetPrice: number | null;
  positionSize: number | null;
  thesis: string | null;
  setupType: string | null;
  status: string;
  actualPnL: number | null;
  createdAt: Date | null;
  latestEvaluation?: {
    score: number;
    recommendation: string;
    riskFlags: string[];
  };
}

export interface EventWithTrade {
  id: number;
  tradeId: number;
  eventType: string;
  description: string | null;
  createdAt: Date | null;
  trade?: {
    symbol: string;
  };
}
