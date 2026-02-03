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
  firstTrimProfit: string | null;
  targetProfit: string | null;
  totalPotentialProfit: string;
}

export interface EvaluationResult {
  // Core decision gate
  score: number;
  status: 'GREEN' | 'YELLOW' | 'RED';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  modelTag: 'BREAKOUT' | 'RECLAIM' | 'CUP_AND_HANDLE' | 'PULLBACK' | 'EPISODIC_PIVOT' | 'UNKNOWN';
  instrumentType?: 'ETF' | 'STOCK' | 'INDEX';
  
  // Verdict summary - primary blockers at top
  verdictSummary?: VerdictSummary;
  
  // Money breakdown - real dollars
  moneyBreakdown?: MoneyBreakdown;
  
  // User's plan summary
  planSummary: PlanSummary;
  
  // Structured feedback
  whyBullets: string[];
  riskFlags: RiskFlagDetail[];
  improvements: string[];
  fixesToPass?: string[]; // Minimum changes needed to reach GREEN
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
  recentEvents: EventWithTrade[];
}

export interface TradeWithEvaluation {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  positionSize: number | null;
  thesis: string | null;
  status: string;
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
