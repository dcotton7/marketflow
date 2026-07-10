// ---------------------------------------------------------------------------
// Discovery Scanner — shared type definitions
// ---------------------------------------------------------------------------

// ── Signal types ────────────────────────────────────────────────────────────

export type SignalType =
  | "volume_spike"
  | "velocity_move"
  | "adr_blowout"
  | "gap"
  | "breadth_shift"
  | "theme_acceleration"
  | "regime_change"
  | "rai_shift"
  | "broad_weakness"
  | "broad_strength"
  | "lod_bounce"
  | "ur_ma_reclaim"
  | "prev_day_high_break"
  | "prev_day_low_break"
  | "five_day_high_break"
  | "five_day_low_break"
  | "ma_proximity"
  | "failed_breakout"
  | "hod_fade"
  | "gap_down_continuation"
  | "news_alert"
  | "earnings_reaction"
  | "theme_earnings_density";

export type SignalSubjectKind = "ticker" | "theme" | "market";

export type SignalDirection = "up" | "down" | "neutral";

export interface Signal {
  id: string;
  type: SignalType;
  subjectKind: SignalSubjectKind;
  subject: string;
  magnitude: number;
  direction: SignalDirection;
  timestamp: Date;
  meta?: Record<string, unknown>;
}

// ── Lens types ──────────────────────────────────────────────────────────────

export type LensId =
  | "theme_membership"
  | "peer_velocity"
  | "sector_flow"
  | "regime_context"
  | "fastest_movers"
  | "cross_theme"
  | "ma_structure"
  | "relative_strength"
  | "earnings_proximity"
  | "news";

export interface ThemeMembershipResult {
  themeId: string;
  themeName: string;
  role: "core" | "candidate";
  peerSymbols: string[];
  etfProxy: string | null;
  themeScore: number;
  themeRank: number;
}

export interface PeerVelocityEntry {
  symbol: string;
  changePct: number;
  volumeRatio: number;
}

export interface PeerVelocityResult {
  peers: PeerVelocityEntry[];
  movingCount: number;
  avgPeerChange: number;
  correlation: number;
  verdict: "isolated" | "cluster" | "sector_wide";
}

export interface SectorFlowResult {
  themeChangePct: number;
  adRatio: { up: number; down: number; neutral: number };
  acceleration: number;
  flowScore: number;
  volumeProfile: "quiet" | "normal" | "elevated" | "surging";
  relativeToMarket: number;
}

export type MarketSession =
  | "pre_market"
  | "open_drive"
  | "mid_morning"
  | "midday"
  | "power_hour"
  | "close"
  | "after_hours"
  | "closed";

export interface RegimeContextResult {
  rai: number;
  raiDelta5min: number;
  regime: string;
  spyChangePct: number;
  breadth: { themesUp: number; themesDown: number; neutral: number };
  session: MarketSession;
}

export interface FastestMoverEntry {
  symbol: string;
  changePct: number;
  volumeRatio: number;
  themeId: string;
}

export interface FastestMoversResult {
  movers: FastestMoverEntry[];
  themeConcentration: Record<string, number>;
  isBroadBased: boolean;
}

export interface CrossThemeEntry {
  themeId: string;
  correlation: number;
  changePct: number;
}

export interface CrossThemeResult {
  contagion: CrossThemeEntry[];
  spreadScore: number;
  interpretation: "isolated" | "sector_bleed" | "risk_off_cascade" | "risk_on_surge";
}

export interface MaStructureResult {
  posture: string;
  maStack: "bullish" | "bearish" | "mixed";
  extensionFrom50d: number;
  extensionFrom20d: number;
  nearKeyLevel: string | null;
}

export interface RelativeStrengthResult {
  rsVsTheme: number;
  rsVsSpy: number;
  rsRank: number;
  isDiverging: boolean;
  divergenceType: "leader" | "laggard" | "aligned";
}

export interface EarningsProximityResult {
  withinNDays: boolean;
  daysUntil: number | null;
  date: string | null;
  earningsTime?: string | null;
}

export interface NewsHeadline {
  source: "finnhub" | "fmp";
  headline: string;
  url: string;
  publishedAt: string;
  relatedTickers: string[];
}

export interface NewsResult {
  headlines: NewsHeadline[];
  corroborated: boolean;
  sourceCount: number;
}

export type LensResult =
  | ThemeMembershipResult
  | PeerVelocityResult
  | SectorFlowResult
  | RegimeContextResult
  | FastestMoversResult
  | CrossThemeResult
  | MaStructureResult
  | RelativeStrengthResult
  | EarningsProximityResult
  | NewsResult;

// ── Pipeline types ──────────────────────────────────────────────────────────

export type ReactionId =
  | "discovery_brief"
  | "watchlist_add"
  | "score_update"
  | "short_candidates"
  | "ai_inquiry"
  | "alert";

export type PipelinePriority = "low" | "normal" | "urgent";
export type PipelineVisibility = "private" | "role" | "global";

export interface PipelineTrigger {
  signalTypes: SignalType[];
  subjectKind?: SignalSubjectKind;
  minMagnitude?: number;
  direction?: SignalDirection;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  enabled: boolean;
  trigger: PipelineTrigger;
  lensIds: LensId[];
  /** TypeScript predicate evaluated against the context map */
  qualifyFn?: string;
  reactions: ReactionId[];
  cooldownMs: number;
  priority: PipelinePriority;
  ownerId: number | "system";
  visibility: PipelineVisibility;
  requiredRole?: string;
}

// ── Enriched signal (pipeline output) ───────────────────────────────────────

export interface EnrichedSignal {
  signal: Signal;
  pipelineId: string;
  pipelineName: string;
  context: Partial<Record<LensId, LensResult>>;
  qualified: boolean;
  qualifyScore: number;
  priority: PipelinePriority;
  timestamp: Date;
}

// ── Discovery (persisted + sent to client) ──────────────────────────────────

export interface DiscoveryCard {
  id: number;
  pipelineId: string;
  pipelineName: string;
  signalType: SignalType;
  subject: string;
  subjectKind: SignalSubjectKind;
  direction: SignalDirection;
  magnitude: number;
  priority: PipelinePriority;
  headline: string;
  narrative: string;
  tickers: string[];
  themeId: string | null;
  context: Partial<Record<LensId, LensResult>>;
  qualifyScore: number;
  createdAt: string;
}

// ── Scanner state (client ↔ server) ─────────────────────────────────────────

export type ScannerMode = "on" | "silent" | "off";

export interface ScannerStatus {
  mode: ScannerMode;
  universeSize: number;
  activePipelines: number;
  lastSignalAt: string | null;
  discoveriesToday: number;
  sessionMode: MarketSession;
}

// ── Font preferences ────────────────────────────────────────────────────────

export interface ScannerFontPrefs {
  card: number;
  headline: number;
}

export const SCANNER_FONT_DEFAULTS: ScannerFontPrefs = {
  card: 12,
  headline: 14,
};
