export interface EvaluationRequest {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopPrice?: number;
  stopPriceLevel?: string;
  targetPrice?: number;
  targetPriceLevel?: string;
  positionSize?: number;
  positionSizeUnit?: 'shares' | 'dollars';
  thesis?: string;
  deepEval?: boolean;
}

export interface EvaluationResult {
  score: number;
  reasoning: string;
  riskFlags: string[];
  recommendation: 'proceed' | 'caution' | 'avoid';
  model: string;
  promptVersion: string;
}

export interface TradeUpdate {
  stopPrice?: number;
  targetPrice?: number;
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
