// ---------------------------------------------------------------------------
// Discovery Scanner — Signal Producer
//
// Sits inside the MC polling loop. After each snapshot refresh, compares
// the current state to a ring buffer of recent snapshots and emits raw
// Signal objects for anything noteworthy.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { Signal, SignalType, SignalDirection, MarketSession } from "@shared/scanner-types";
import { DEFAULT_SCANNER_CONFIG, type ScannerConfig } from "@shared/scanner-config";
import { isDailyBarApiHealthy } from "../data-layer/daily-bar-refresh";
import { getClusterTickers, CLUSTERS, type ClusterId } from "../market-condition/universe";
import { getCachedEarningsData } from "../fundamentals";

// ── Live config (mutable, updated via admin API) ────────────────────────────

let cfg: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG };

export function getScannerConfig(): ScannerConfig { return cfg; }
export function setScannerConfig(next: Partial<ScannerConfig>): void {
  cfg = { ...cfg, ...next };
}

// ── Snapshot frame (lightweight slice of MC state) ──────────────────────────

export interface TickerFrame {
  price: number;
  changePct: number;
  volume: number;
  avgVolume14d: number;
  /** Prior-day dollar volume ≈ prevClose × avg/prior volume (liquidity filter). */
  priorDayDollarVol: number;
  extensionFrom20dAdr: number;
  prevClose: number;
  todayOpen: number;
  todayHigh: number;
  todayLow: number;
  sma20d: number | null;
  sma50d: number | null;
  sma200d: number | null;
  prevDayHigh: number;
  prevDayLow: number;
}

export interface ThemeFrame {
  score: number;
  acceleration: number;
  membersUp: number;
  membersDown: number;
  memberCount: number;
  rank: number;
  percentile: number;
}

export interface SnapshotFrame {
  timestamp: Date;
  tickers: Map<string, TickerFrame>;
  themes: Map<string, ThemeFrame>;
  rai: number;
  regime: string;
  spyChangePct: number;
}

// ── Ring buffer ─────────────────────────────────────────────────────────────

const BUFFER_SIZE = 10; // ~5 minutes at 30s intervals (reduced from 20 to save memory)
const ringBuffer: SnapshotFrame[] = [];

/** Monotonic frame id — ringBuffer.length caps at BUFFER_SIZE and cannot be used for "frames since X". */
let frameSeq = 0;

export function pushFrame(frame: SnapshotFrame): void {
  frameSeq += 1;
  ringBuffer.push(frame);
  if (ringBuffer.length > BUFFER_SIZE) ringBuffer.shift();
}

export function getFrame(offset: number): SnapshotFrame | null {
  const idx = ringBuffer.length - 1 - offset;
  return idx >= 0 ? ringBuffer[idx]! : null;
}

export function currentFrame(): SnapshotFrame | null {
  return ringBuffer.length > 0 ? ringBuffer[ringBuffer.length - 1]! : null;
}

export function getBufferLength(): number {
  return ringBuffer.length;
}

export function getFrameSeq(): number {
  return frameSeq;
}

// ── Cooldown tracker ────────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();

function isCoolingDown(key: string, cooldownMs: number): boolean {
  const lastFired = cooldowns.get(key);
  if (lastFired && Date.now() - lastFired < cooldownMs) return true;
  return false;
}

function markFired(key: string): void {
  cooldowns.set(key, Date.now());
}

function clearCooldown(key: string): void {
  cooldowns.delete(key);
}

/** Prune cooldown entries older than 30 minutes to prevent unbounded growth. */
export function pruneCooldowns(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [key, ts] of cooldowns) {
    if (ts < cutoff) cooldowns.delete(key);
  }
}

const TRACKER_MAX_ENTRIES = 500;
const TRACKER_PRUNE_AGE_MS = 60 * 60_000; // 1 hour

/** Prune all secondary tracker Maps to prevent unbounded growth. */
export function pruneTrackers(): void {
  const now = Date.now();
  const cutoff = now - TRACKER_PRUNE_AGE_MS;

  for (const [key, ts] of recentlyAboveLevel) {
    if (ts < cutoff) recentlyAboveLevel.delete(key);
  }
  if (recentlyAboveLevel.size > TRACKER_MAX_ENTRIES) {
    const excess = recentlyAboveLevel.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of recentlyAboveLevel.keys()) {
      if (removed >= excess) break;
      recentlyAboveLevel.delete(key);
      removed++;
    }
  }

  // Cap maPositionHistory
  if (maPositionHistory.size > TRACKER_MAX_ENTRIES) {
    const excess = maPositionHistory.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of maPositionHistory.keys()) {
      if (removed >= excess) break;
      maPositionHistory.delete(key);
      removed++;
    }
  }

  // Cap pendingBreaks
  if (pendingBreaks.size > TRACKER_MAX_ENTRIES) {
    const excess = pendingBreaks.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of pendingBreaks.keys()) {
      if (removed >= excess) break;
      pendingBreaks.delete(key);
      removed++;
    }
  }

  // Cap lastAboveBreakLevel
  if (lastAboveBreakLevel.size > TRACKER_MAX_ENTRIES) {
    const excess = lastAboveBreakLevel.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of lastAboveBreakLevel.keys()) {
      if (removed >= excess) break;
      lastAboveBreakLevel.delete(key);
      removed++;
    }
  }

  // Cap hodFrameTracker
  if (hodFrameTracker.size > TRACKER_MAX_ENTRIES) {
    const excess = hodFrameTracker.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of hodFrameTracker.keys()) {
      if (removed >= excess) break;
      hodFrameTracker.delete(key);
      removed++;
    }
  }

  // Cap lodTracker
  if (lodTracker.size > TRACKER_MAX_ENTRIES) {
    const excess = lodTracker.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of lodTracker.keys()) {
      if (removed >= excess) break;
      lodTracker.delete(key);
      removed++;
    }
  }

  // Cap fiveDayHighLow
  if (fiveDayHighLow.size > TRACKER_MAX_ENTRIES) {
    const excess = fiveDayHighLow.size - TRACKER_MAX_ENTRIES;
    let removed = 0;
    for (const key of fiveDayHighLow.keys()) {
      if (removed >= excess) break;
      fiveDayHighLow.delete(key);
      removed++;
    }
  }

  // Daily session maps: clear if date has changed
  const today = new Date().toISOString().slice(0, 10);
  for (const [sym, date] of gapFiredForSession) {
    if (date !== today) gapFiredForSession.delete(sym);
  }
  for (const [sym, date] of earningsReactionFiredToday) {
    if (date !== today) earningsReactionFiredToday.delete(sym);
  }
  for (const [sym, date] of earningsDensityFiredToday) {
    if (date !== today) earningsDensityFiredToday.delete(sym);
  }
}

// ── Signal factory ──────────────────────────────────────────────────────────

function makeSignal(
  type: SignalType,
  subjectKind: Signal["subjectKind"],
  subject: string,
  magnitude: number,
  direction: SignalDirection,
  meta?: Record<string, unknown>
): Signal {
  return {
    id: randomUUID(),
    type,
    subjectKind,
    subject,
    magnitude,
    direction,
    timestamp: new Date(),
    meta,
  };
}

// ── Helper: minutes → ms from live config ───────────────────────────────────

function min2ms(minutes: number): number { return minutes * 60_000; }

// Track pending breakout confirmations (must hold for N frames)
const pendingBreaks = new Map<string, { level: number; framesAbove: number; direction: "up" | "down"; meta: Record<string, unknown> }>();

// Track recent MA positions for U&R detection (50d + 200d only; 20d uses proximity watch)
const maPositionHistory = new Map<string, {
  below200: number; below50: number;
  frames200: number; frames50: number;
}>();

const MA_MIN_FRAMES_BELOW = 3; // Must be below for 3+ consecutive frames (~90s) to count

// Track whether ticker was above break level recently (for freshness)
const recentlyAboveLevel = new Map<string, number>();

// ── Ticker-level detectors ──────────────────────────────────────────────────

function detectVolumeSpikes(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  for (const [symbol, tick] of current.tickers) {
    if (tick.avgVolume14d <= 0) continue;
    const ratio = tick.volume / tick.avgVolume14d;
    if (ratio < cfg.volumeSpikeThreshold) continue;

    const key = `volume_spike:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.volumeSpikeCooldownMin))) continue;

    markFired(key);
    signals.push(
      makeSignal("volume_spike", "ticker", symbol, Math.round(ratio * 10) / 10,
        tick.changePct >= 0 ? "up" : "down",
        { volumeRatio: ratio, changePct: tick.changePct })
    );
  }
  return signals;
}

function detectVelocityMoves(current: SnapshotFrame): Signal[] {
  const prev = getFrame(cfg.velocityWindowFrames);
  if (!prev) return [];

  const signals: Signal[] = [];
  for (const [symbol, tick] of current.tickers) {
    const prevTick = prev.tickers.get(symbol);
    if (!prevTick || prevTick.price <= 0) continue;

    const pctMove = ((tick.price - prevTick.price) / prevTick.price) * 100;
    if (Math.abs(pctMove) < cfg.velocityThresholdPct) continue;

    const key = `velocity_move:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.velocityCooldownMin))) continue;

    markFired(key);
    signals.push(
      makeSignal("velocity_move", "ticker", symbol,
        Math.round(Math.abs(pctMove) * 100) / 100,
        pctMove >= 0 ? "up" : "down",
        { pctMove: Math.round(pctMove * 100) / 100 })
    );
  }
  return signals;
}

function detectAdrBlowouts(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  for (const [symbol, tick] of current.tickers) {
    const ext = tick.extensionFrom20dAdr;
    if (Math.abs(ext) < cfg.adrBlowoutThreshold) continue;

    const key = `adr_blowout:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.adrBlowoutCooldownMin))) continue;

    markFired(key);
    signals.push(
      makeSignal("adr_blowout", "ticker", symbol,
        Math.round(Math.abs(ext) * 10) / 10,
        ext >= 0 ? "up" : "down",
        { extensionFrom20dAdr: ext })
    );
  }
  return signals;
}

const gapFiredForSession = new Map<string, string>();

function detectGaps(current: SnapshotFrame): Signal[] {
  const today = new Date().toISOString().slice(0, 10);

  const signals: Signal[] = [];
  for (const [symbol, tick] of current.tickers) {
    const gapPct = tick.changePct;
    if (Math.abs(gapPct) < cfg.gapThresholdPct) continue;

    if (gapFiredForSession.get(symbol) === today) continue;

    const key = `gap:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.gapCooldownMin))) continue;

    gapFiredForSession.set(symbol, today);
    markFired(key);
    signals.push(
      makeSignal("gap", "ticker", symbol,
        Math.round(Math.abs(gapPct) * 100) / 100,
        gapPct >= 0 ? "up" : "down",
        { gapPct: Math.round(gapPct * 100) / 100 })
    );
  }
  return signals;
}

// ── Theme-level detectors ───────────────────────────────────────────────────

interface TopMover {
  symbol: string;
  changePct: number;
  volumeRatio: number;
}

// Inverse/leveraged ETFs move opposite to their sector — exclude from theme mover lists
const INVERSE_LEVERAGED_ETFS: Set<string> = (() => {
  const s = new Set<string>();
  for (const c of CLUSTERS) {
    for (const etf of c.etfProxies) {
      if (etf.proxyType === "inverse" || etf.proxyType === "leveraged") {
        s.add(etf.symbol.toUpperCase());
      }
    }
  }
  return s;
})();

function getTopMovers(
  themeId: string,
  current: SnapshotFrame,
  direction: SignalDirection,
  limit = 5,
): TopMover[] {
  const members = getClusterTickers(themeId as ClusterId);
  const movers: TopMover[] = [];
  for (const sym of members) {
    if (INVERSE_LEVERAGED_ETFS.has(sym)) continue;
    const tick = current.tickers.get(sym);
    if (!tick) continue;
    const volRatio = tick.avgVolume14d > 0 ? tick.volume / tick.avgVolume14d : 0;
    movers.push({
      symbol: sym,
      changePct: Math.round(tick.changePct * 100) / 100,
      volumeRatio: Math.round(volRatio * 10) / 10,
    });
  }

  if (direction === "up") {
    movers.sort((a, b) => b.changePct - a.changePct);
  } else if (direction === "down") {
    movers.sort((a, b) => a.changePct - b.changePct);
  } else {
    movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  }

  return movers.slice(0, limit);
}

const MIN_ACTIVE_THEME_TICKERS = 4;

function countActiveThemeTickers(themeId: string, current: SnapshotFrame): number {
  const tickers = getClusterTickers(themeId as ClusterId);
  let active = 0;
  for (const sym of tickers) {
    const tick = current.tickers.get(sym);
    if (!tick) continue;
    if (Math.abs(tick.changePct) > 0.01 || (tick.avgVolume14d > 0 && tick.volume / tick.avgVolume14d > 0)) {
      active++;
    }
  }
  return active;
}

function detectBreadthShifts(current: SnapshotFrame, session?: MarketSession): Signal[] {
  const prev = getFrame(cfg.breadthShiftWindowFrames);
  if (!prev) return [];

  const extendedHours = session === "after_hours" || session === "pre_market";
  const signals: Signal[] = [];
  for (const [themeId, theme] of current.themes) {
    const prevTheme = prev.themes.get(themeId);
    if (!prevTheme || prevTheme.memberCount === 0 || theme.memberCount === 0) continue;

    if (extendedHours && countActiveThemeTickers(themeId, current) < MIN_ACTIVE_THEME_TICKERS) continue;

    const currRatio = theme.membersUp / theme.memberCount;
    const prevRatio = prevTheme.membersUp / prevTheme.memberCount;
    const delta = currRatio - prevRatio;
    if (Math.abs(delta) < cfg.breadthShiftThreshold) continue;

    const key = `breadth_shift:${themeId}`;
    if (isCoolingDown(key, min2ms(cfg.breadthShiftCooldownMin))) continue;

    markFired(key);
    const dir: SignalDirection = delta >= 0 ? "up" : "down";
    const topMovers = getTopMovers(themeId, current, dir);
    signals.push(
      makeSignal("breadth_shift", "theme", themeId,
        Math.round(Math.abs(delta) * 100) / 100,
        dir,
        { currRatio, prevRatio, delta, topMovers })
    );
  }
  return signals;
}

function detectThemeAccelerations(current: SnapshotFrame, session?: MarketSession): Signal[] {
  const prev = getFrame(cfg.breadthShiftWindowFrames);
  if (!prev) return [];

  const extendedHours = session === "after_hours" || session === "pre_market";
  const signals: Signal[] = [];
  for (const [themeId, theme] of current.themes) {
    const prevTheme = prev.themes.get(themeId);
    if (!prevTheme) continue;

    if (extendedHours && countActiveThemeTickers(themeId, current) < MIN_ACTIVE_THEME_TICKERS) continue;

    const scoreDelta = theme.score - prevTheme.score;
    if (Math.abs(scoreDelta) < cfg.themeAccelThreshold) continue;

    // Don't label a theme "surging" if its absolute score is still weak,
    // or "weakening" if it's still strong — use softer verbs via metadata
    const isUp = scoreDelta >= 0;
    const absScore = theme.score;
    const contradictory = (isUp && absScore < 30) || (!isUp && absScore > 70);

    const key = `theme_acceleration:${themeId}`;
    if (isCoolingDown(key, min2ms(cfg.themeAccelCooldownMin))) continue;

    markFired(key);
    const dir: SignalDirection = isUp ? "up" : "down";
    const topMovers = getTopMovers(themeId, current, dir);
    signals.push(
      makeSignal("theme_acceleration", "theme", themeId,
        Math.round(Math.abs(scoreDelta) * 10) / 10,
        dir,
        { scoreDelta, currentScore: theme.score, contradictory, topMovers })
    );
  }
  return signals;
}

// ── Market-level detectors ──────────────────────────────────────────────────

function detectRegimeChange(current: SnapshotFrame): Signal[] {
  const prev = getFrame(1);
  if (!prev || prev.regime === current.regime) return [];

  const key = `regime_change:${current.regime}`;
  if (isCoolingDown(key, 30 * 60_000)) return [];

  markFired(key);
  return [
    makeSignal("regime_change", "market", "MARKET", 1, "neutral",
      { from: prev.regime, to: current.regime })
  ];
}

function detectRaiShift(current: SnapshotFrame): Signal[] {
  const prev = getFrame(cfg.raiShiftWindowFrames);
  if (!prev) return [];

  const delta = current.rai - prev.rai;
  if (Math.abs(delta) < cfg.raiShiftThreshold) return [];

  const key = `rai_shift:MARKET`;
  if (isCoolingDown(key, min2ms(cfg.raiShiftCooldownMin))) return [];

  markFired(key);
  return [
    makeSignal("rai_shift", "market", "MARKET",
      Math.round(Math.abs(delta) * 10) / 10,
      delta >= 0 ? "up" : "down",
      { raiDelta: delta, currentRai: current.rai })
  ];
}

function detectBroadMoves(current: SnapshotFrame, session?: MarketSession): Signal[] {
  const prev = getFrame(cfg.breadthShiftWindowFrames);
  if (!prev) return [];

  const extendedHours = session === "after_hours" || session === "pre_market";
  let themesDown = 0;
  let themesUp = 0;
  for (const [themeId, theme] of current.themes) {
    const prevTheme = prev.themes.get(themeId);
    if (!prevTheme) continue;
    if (extendedHours && countActiveThemeTickers(themeId, current) < MIN_ACTIVE_THEME_TICKERS) continue;
    const scoreDelta = theme.score - prevTheme.score;
    if (scoreDelta < -2.0) themesDown++;
    if (scoreDelta > 2.0) themesUp++;
  }

  // Mutually exclusive: net direction wins
  const net = themesUp - themesDown;

  if (net <= -3 && themesDown >= cfg.broadMoveThemeCount) {
    const key = "broad_weakness:MARKET";
    if (!isCoolingDown(key, min2ms(cfg.broadMoveCooldownMin))) {
      markFired(key);
      return [
        makeSignal("broad_weakness", "market", "MARKET", themesDown, "down",
          { themesDown, themesUp, net })
      ];
    }
  }

  if (net >= 3 && themesUp >= cfg.broadMoveThemeCount) {
    const key = "broad_strength:MARKET";
    if (!isCoolingDown(key, min2ms(cfg.broadMoveCooldownMin))) {
      markFired(key);
      return [
        makeSignal("broad_strength", "market", "MARKET", themesUp, "up",
          { themesUp, themesDown, net })
      ];
    }
  }

  return [];
}

// ── Intraday trade setup detectors ──────────────────────────────────────────

// Track LOD per ticker + highest price since that LOD (peak of the bounce).
// Firing only on current-%-above-LOD misses DELL-style spikes (397→412) that pull back.
const lodTracker = new Map<string, {
  lodPrice: number;
  lodFrameSeq: number;
  maxSinceLod: number;
  firedPeakPct: number;
  /** Prior bounce gave up near LOD — next tier-1 reclaim is a fresh alert. */
  armedAfterFail: boolean;
}>();

/** Re-arm LOD bounce after a failed attempt so a reclaim of the same LOD can fire again. */
function rearmLodBounceAfterFail(
  symbol: string,
  tracker: { lodPrice: number; maxSinceLod: number; firedPeakPct: number; armedAfterFail: boolean },
  price: number
): void {
  tracker.firedPeakPct = 0;
  tracker.maxSinceLod = Math.max(price, tracker.lodPrice);
  tracker.armedAfterFail = true;
  clearCooldown(`lod_bounce:${symbol}:t1`);
  clearCooldown(`lod_bounce:${symbol}:t2`);
}

/** Called when live LOD cards clear for give-up (keeps detector in sync with UI). */
export function onLodBounceGaveUp(symbols: string[]): void {
  for (const symbol of symbols) {
    const tracker = lodTracker.get(symbol);
    if (!tracker) continue;
    const tick = currentFrame()?.tickers.get(symbol);
    const price = tick?.price ?? tracker.lodPrice;
    rearmLodBounceAfterFail(symbol, tracker, price);
  }
}

/**
 * Count recent rising-price frames after the LOD (bounded by ring buffer).
 * lodFrameSeq is absolute; map it into the ring so shifted frames still work.
 */
function measureBounceQuality(symbol: string, current: SnapshotFrame): {
  consecutiveUpFrames: number;
  bounceBarVolumeRatio: number;
} {
  const tracker = lodTracker.get(symbol);
  if (!tracker) return { consecutiveUpFrames: 0, bounceBarVolumeRatio: 0 };

  const framesAgo = Math.max(0, frameSeq - tracker.lodFrameSeq);
  const startIdx = Math.max(0, ringBuffer.length - 1 - framesAgo);
  const bufLen = ringBuffer.length;
  let consecutiveUp = 0;
  let bounceBarVolRatio = 0;

  for (let i = startIdx + 1; i < bufLen; i++) {
    const frameTick = ringBuffer[i]?.tickers.get(symbol);
    const prevFrameTick = ringBuffer[i - 1]?.tickers.get(symbol);
    if (!frameTick || !prevFrameTick) break;
    if (frameTick.price > prevFrameTick.price) {
      consecutiveUp++;
      if (consecutiveUp === 1 && frameTick.avgVolume14d > 0) {
        bounceBarVolRatio = frameTick.volume / frameTick.avgVolume14d;
      }
    } else {
      break;
    }
  }

  if (bounceBarVolRatio === 0) {
    const tick = current.tickers.get(symbol);
    if (tick && tick.avgVolume14d > 0) {
      bounceBarVolRatio = tick.volume / tick.avgVolume14d;
    }
  }

  return {
    consecutiveUpFrames: consecutiveUp,
    bounceBarVolumeRatio: Math.round(bounceBarVolRatio * 100) / 100,
  };
}

function rthVolumeProgress(): number {
  // Fraction of the RTH session elapsed (0.05–1.0). Used to compare cumulative
  // volume vs full-day average volume so morning setups aren't rejected.
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(et.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(et.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (mins <= open) return 0.05;
  if (mins >= close) return 1;
  return Math.min(1, Math.max(0.05, (mins - open) / (close - open)));
}

/**
 * Minimum cumulative-volume / avg-day-volume for LOD bounce at this time of day.
 * Must track RTH progress — a hard 0.20 floor rejects every open bounce
 * (CRWD/IGV at 9:37 were ~0.05–0.09× prior day with real session volume).
 */
function lodBounceMinVolumeRatio(): number {
  const progress = rthVolumeProgress();
  // ~half of a normal day's pace by this clock time; tiny floor only filters noise.
  return Math.max(0.02, progress * 0.5);
}

function detectLodBounce(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  const minVolRatio = lodBounceMinVolumeRatio();

  // Update LOD tracker + peak price since that LOD
  for (const [symbol, tick] of current.tickers) {
    if (tick.todayLow <= 0 || tick.price <= 0) continue;
    const tracker = lodTracker.get(symbol);

    // New session LOD (lower low) → reset peak tracking
    if (!tracker || tick.todayLow < tracker.lodPrice - 1e-6) {
      lodTracker.set(symbol, {
        lodPrice: tick.todayLow,
        lodFrameSeq: frameSeq,
        maxSinceLod: tick.price,
        firedPeakPct: 0,
        armedAfterFail: false,
      });
      // Fall through — if price already bounced off this new/seeded LOD, fire same frame
    } else {
      // Same LOD: raise peak from snapshot prices only.
      // Never use todayHigh — on dump days that high printed *before* the LOD (DELL ~461).
      tracker.maxSinceLod = Math.max(tracker.maxSinceLod, tick.price);

      // Failed bounce: back within give-up band of LOD after a fire → re-arm for reclaim.
      if (tracker.firedPeakPct > 0) {
        const pctAbove = ((tick.price - tracker.lodPrice) / tracker.lodPrice) * 100;
        if (pctAbove < cfg.lodBounceGiveUpPct) {
          rearmLodBounceAfterFail(symbol, tracker, tick.price);
        }
      }
    }
  }

  for (const [symbol, tick] of current.tickers) {
    if (tick.todayLow <= 0 || tick.price <= 0) continue;
    const tracker = lodTracker.get(symbol);
    if (!tracker) continue;

    const lod = tracker.lodPrice;
    const pctCurrentAboveLod = ((tick.price - lod) / lod) * 100;
    // Still on / under the low — not a bounce structure
    if (pctCurrentAboveLod < 0.25) continue;

    const peak = tracker.maxSinceLod;
    const pctPeakAboveLod = ((peak - lod) / lod) * 100;
    // Fire on peak excursion off LOD (412 on DELL), not only where price sits now
    if (pctPeakAboveLod < cfg.lodBounceTier1Pct) continue;
    // Already too extended for a bounce entry — leave feed space for earlier cards to clear
    if (pctPeakAboveLod >= cfg.lodBounceClearMaxPct) continue;

    // Don't re-fire near-identical peaks off the same LOD
    if (pctPeakAboveLod <= tracker.firedPeakPct + 0.25) continue;

    if (Math.abs(tick.extensionFrom20dAdr) > cfg.lodBounceMaxAtrExt) continue;

    const volumeKnown = tick.avgVolume14d > 0;
    const volumeRatio = volumeKnown ? tick.volume / tick.avgVolume14d : 0;
    // Only enforce the session-aware floor when we have a real volume baseline.
    // Missing avg volume used to hard-zero every LOD bounce (and volume_spike).
    if (volumeKnown && volumeRatio < minVolRatio) continue;

    const aboveSma20 = tick.sma20d != null && tick.price > tick.sma20d;
    const aboveSma50 = tick.sma50d != null && tick.price > tick.sma50d;
    const aboveSma200 = tick.sma200d != null ? tick.price > tick.sma200d : null;
    const changePct = tick.changePct;

    const { consecutiveUpFrames, bounceBarVolumeRatio } = measureBounceQuality(symbol, current);

    const tier = pctPeakAboveLod >= cfg.lodBounceTier2Pct ? 2 : 1;
    const key = `lod_bounce:${symbol}:t${tier}`;
    if (isCoolingDown(key, min2ms(cfg.lodBounceCooldownMin))) continue;

    markFired(key);
    const reclaimAfterFail = tracker.armedAfterFail;
    tracker.firedPeakPct = pctPeakAboveLod;
    tracker.armedAfterFail = false;

    signals.push(
      makeSignal("lod_bounce", "ticker", symbol,
        Math.round(pctPeakAboveLod * 100) / 100,
        "up",
        {
          pctAboveLod: Math.round(pctCurrentAboveLod * 100) / 100,
          pctPeakAboveLod: Math.round(pctPeakAboveLod * 100) / 100,
          peakPrice: Math.round(peak * 100) / 100,
          tier,
          todayLow: lod,
          volumeRatio: Math.round(volumeRatio * 100) / 100,
          volumeKnown,
          bounceBarVolumeRatio,
          consecutiveUpFrames,
          aboveSma20,
          aboveSma50,
          aboveSma200,
          changePct: Math.round(changePct * 100) / 100,
          minVolRatio: Math.round(minVolRatio * 100) / 100,
          reclaimAfterFail,
        })
    );
  }
  return signals;
}

function detectMaReclaim(current: SnapshotFrame): Signal[] {
  if (!isDailyBarApiHealthy()) return [];

  const signals: Signal[] = [];
  const now = Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60_000;

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0) continue;

    const history = maPositionHistory.get(symbol) ?? {
      below200: 0, below50: 0,
      frames200: 0, frames50: 0,
    };

    if (tick.sma200d != null && tick.price < tick.sma200d) {
      history.frames200++;
      if (history.frames200 >= MA_MIN_FRAMES_BELOW) history.below200 = now;
    } else {
      history.frames200 = 0;
    }
    if (tick.sma50d != null && tick.price < tick.sma50d) {
      history.frames50++;
      if (history.frames50 >= MA_MIN_FRAMES_BELOW) history.below50 = now;
    } else {
      history.frames50 = 0;
    }
    maPositionHistory.set(symbol, history);

    const checks: Array<{ ma: number | null; label: string; lastBelow: number; priority: number; maxExtPct: number }> = [
      { ma: tick.sma200d, label: "200d", lastBelow: history.below200, priority: 3, maxExtPct: cfg.maReclaim200dMaxExtPct },
      { ma: tick.sma50d, label: "50d", lastBelow: history.below50, priority: 2, maxExtPct: cfg.maReclaim50dMaxExtPct },
    ];

    for (const check of checks) {
      if (check.ma == null || check.lastBelow === 0) continue;
      if (tick.price <= check.ma) continue;
      if (now - check.lastBelow > twoDaysMs) continue;

      const extAboveMa = ((tick.price - check.ma) / check.ma) * 100;
      if (extAboveMa > check.maxExtPct) continue;

      const key = `ur_ma_reclaim:${symbol}:${check.label}`;
      if (isCoolingDown(key, min2ms(cfg.maReclaimCooldownMin))) continue;

      markFired(key);
      signals.push(
        makeSignal("ur_ma_reclaim", "ticker", symbol,
          check.priority,
          "up",
          { maLevel: check.label, maValue: check.ma, price: tick.price, extAboveMaPct: Math.round(extAboveMa * 100) / 100 })
      );
      break;
    }
  }
  return signals;
}

// ── 20d MA Proximity Watch ──────────────────────────────────────────────────
// Fires when price is within N% of the 20d SMA (above or below).
// Repeats every 30 min intraday; resets each new trading day.

let lastProximityDate = "";

function detectMaProximity(current: SnapshotFrame): Signal[] {
  if (!isDailyBarApiHealthy()) return [];

  const today = new Date().toISOString().slice(0, 10);
  if (lastProximityDate && lastProximityDate !== today) {
    for (const [key] of cooldowns) {
      if (key.startsWith("ma_proximity:")) cooldowns.delete(key);
    }
  }
  lastProximityDate = today;

  const signals: Signal[] = [];
  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0 || tick.sma20d == null) continue;

    const distancePct = ((tick.price - tick.sma20d) / tick.sma20d) * 100;
    if (Math.abs(distancePct) > cfg.maProximityThresholdPct) continue;

    const key = `ma_proximity:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.maProximityCooldownMin))) continue;

    markFired(key);
    signals.push(
      makeSignal("ma_proximity", "ticker", symbol,
        Math.round(Math.abs(distancePct) * 100) / 100,
        distancePct >= 0 ? "up" : "down",
        {
          maLevel: "20d",
          maValue: tick.sma20d,
          price: tick.price,
          distancePct: Math.round(distancePct * 100) / 100,
          side: distancePct >= 0 ? "above" : "below",
        })
    );
  }
  return signals;
}

/**
 * Check if a ticker was on the other side of a level recently (freshness gate).
 * Prevents firing for tickers that were already beyond the level when scanner started.
 */
function wasRecentlyAbove(key: string): boolean {
  if (!cfg.breakFreshnessRequired) return true;
  const ts = recentlyAboveLevel.get(key);
  if (!ts) return false;
  // Must have been above within the freshness window
  const maxAge = cfg.breakFreshnessWindowFrames * 30_000;
  return Date.now() - ts < maxAge;
}

/** % price is already through a break level (positive = beyond in break direction). */
function thruLevelPct(price: number, level: number, direction: "up" | "down"): number {
  if (level <= 0) return 0;
  return direction === "up"
    ? ((price - level) / level) * 100
    : ((level - price) / level) * 100;
}

function isTooFarThrough(price: number, level: number, direction: "up" | "down"): boolean {
  const maxThru = cfg.breakMaxThruPct ?? 1.5;
  return thruLevelPct(price, level, direction) > maxThru;
}

function detectPrevDayBreaks(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  const clearance = cfg.breakClearancePct / 100;

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0 || tick.prevDayHigh <= 0 || tick.prevDayLow <= 0) continue;

    // ── Long: breaking above prev day high ──
    const longKey = `prev_day_high_break:${symbol}`;
    const longLevel = tick.prevDayHigh * (1 + clearance);

    if (tick.price <= longLevel) {
      // Ticker is below the break level → record as "recently above" for freshness
      recentlyAboveLevel.set(longKey, Date.now());
      pendingBreaks.delete(longKey);
    } else if (tick.price > longLevel && tick.sma200d != null && tick.price > tick.sma200d) {
      if (isTooFarThrough(tick.price, tick.prevDayHigh, "up")) {
        pendingBreaks.delete(longKey);
      } else if (!wasRecentlyAbove(longKey)) { /* skip — was already above when scanner started */ }
      else {
        const pending = pendingBreaks.get(longKey);
        if (pending && pending.direction === "up") {
          pending.framesAbove++;
          if (pending.framesAbove >= cfg.breakConfirmFrames && !isCoolingDown(longKey, min2ms(cfg.breakCooldownMin))) {
            if (isTooFarThrough(tick.price, tick.prevDayHigh, "up")) {
              pendingBreaks.delete(longKey);
            } else {
              markFired(longKey);
              pendingBreaks.delete(longKey);
              signals.push(
                makeSignal("prev_day_high_break", "ticker", symbol,
                  Math.round(((tick.price - tick.prevDayHigh) / tick.prevDayHigh) * 10000) / 100,
                  "up",
                  { prevDayHigh: tick.prevDayHigh, above200d: true })
              );
            }
          }
        } else if (!isCoolingDown(longKey, min2ms(cfg.breakCooldownMin))) {
          pendingBreaks.set(longKey, { level: tick.prevDayHigh, framesAbove: 1, direction: "up", meta: {} });
        }
      }
    }

    // ── Short: breaking below prev day low ──
    const shortKey = `prev_day_low_break:${symbol}`;
    const shortLevel = tick.prevDayLow * (1 - clearance);

    if (tick.price >= shortLevel) {
      recentlyAboveLevel.set(shortKey, Date.now());
      pendingBreaks.delete(shortKey);
    } else if (tick.price < shortLevel) {
      if (isTooFarThrough(tick.price, tick.prevDayLow, "down")) {
        pendingBreaks.delete(shortKey);
      } else if (!wasRecentlyAbove(shortKey)) { /* skip — stale */ }
      else {
        const pending = pendingBreaks.get(shortKey);
        if (pending && pending.direction === "down") {
          pending.framesAbove++;
          if (pending.framesAbove >= cfg.breakConfirmFrames && !isCoolingDown(shortKey, min2ms(cfg.breakCooldownMin))) {
            if (isTooFarThrough(tick.price, tick.prevDayLow, "down")) {
              pendingBreaks.delete(shortKey);
            } else {
              markFired(shortKey);
              pendingBreaks.delete(shortKey);
              const below200 = tick.sma200d != null && tick.price < tick.sma200d;
              const below50 = tick.sma50d != null && tick.price < tick.sma50d;
              signals.push(
                makeSignal("prev_day_low_break", "ticker", symbol,
                  Math.round(((tick.prevDayLow - tick.price) / tick.prevDayLow) * 10000) / 100,
                  "down",
                  { prevDayLow: tick.prevDayLow, below200d: below200, below50d: below50, shortPriority: below200 && below50 ? "urgent" : below200 ? "high" : below50 ? "elevated" : "low" })
              );
            }
          }
        } else if (!isCoolingDown(shortKey, min2ms(cfg.breakCooldownMin))) {
          pendingBreaks.set(shortKey, { level: tick.prevDayLow, framesAbove: 1, direction: "down", meta: {} });
        }
      }
    }
  }
  return signals;
}

// 5-day high/low tracking: maintained per-ticker across frames
const fiveDayHighLow = new Map<string, { high5d: number; low5d: number }>();

export function setFiveDayHighLow(data: Map<string, { high5d: number; low5d: number }>): void {
  data.forEach((v, k) => fiveDayHighLow.set(k, v));
}

function detectFiveDayBreaks(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  const clearance = cfg.breakClearancePct / 100;

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0) continue;
    const levels = fiveDayHighLow.get(symbol);
    if (!levels) continue;

    // ── Long: breaking above 5-day high ──
    const longKey = `five_day_high_break:${symbol}`;
    const longLevel = levels.high5d * (1 + clearance);

    if (tick.price <= longLevel) {
      recentlyAboveLevel.set(longKey, Date.now());
      pendingBreaks.delete(longKey);
    } else if (tick.price > longLevel && tick.sma200d != null && tick.price > tick.sma200d) {
      // Gap-and-gone / already extended through — not a fresh break
      if (isTooFarThrough(tick.price, levels.high5d, "up")) {
        pendingBreaks.delete(longKey);
      } else if (!wasRecentlyAbove(longKey)) { /* stale */ }
      else {
        const pending = pendingBreaks.get(longKey);
        if (pending && pending.direction === "up") {
          pending.framesAbove++;
          if (pending.framesAbove >= cfg.breakConfirmFrames && !isCoolingDown(longKey, min2ms(cfg.breakCooldownMin))) {
            if (isTooFarThrough(tick.price, levels.high5d, "up")) {
              pendingBreaks.delete(longKey);
            } else {
              markFired(longKey);
              pendingBreaks.delete(longKey);
              signals.push(
                makeSignal("five_day_high_break", "ticker", symbol,
                  Math.round(((tick.price - levels.high5d) / levels.high5d) * 10000) / 100,
                  "up",
                  { fiveDayHigh: levels.high5d, above200d: true })
              );
            }
          }
        } else if (!isCoolingDown(longKey, min2ms(cfg.breakCooldownMin))) {
          pendingBreaks.set(longKey, { level: levels.high5d, framesAbove: 1, direction: "up", meta: {} });
        }
      }
    }

    // ── Short: breaking below 5-day low ──
    const shortKey = `five_day_low_break:${symbol}`;
    const shortLevel = levels.low5d * (1 - clearance);

    if (tick.price >= shortLevel) {
      recentlyAboveLevel.set(shortKey, Date.now());
      pendingBreaks.delete(shortKey);
    } else if (tick.price < shortLevel) {
      if (isTooFarThrough(tick.price, levels.low5d, "down")) {
        pendingBreaks.delete(shortKey);
      } else if (!wasRecentlyAbove(shortKey)) { /* stale */ }
      else {
        const pending = pendingBreaks.get(shortKey);
        if (pending && pending.direction === "down") {
          pending.framesAbove++;
          if (pending.framesAbove >= cfg.breakConfirmFrames && !isCoolingDown(shortKey, min2ms(cfg.breakCooldownMin))) {
            if (isTooFarThrough(tick.price, levels.low5d, "down")) {
              pendingBreaks.delete(shortKey);
            } else {
              markFired(shortKey);
              pendingBreaks.delete(shortKey);
              const below200 = tick.sma200d != null && tick.price < tick.sma200d;
              const below50 = tick.sma50d != null && tick.price < tick.sma50d;
              signals.push(
                makeSignal("five_day_low_break", "ticker", symbol,
                  Math.round(((levels.low5d - tick.price) / levels.low5d) * 10000) / 100,
                  "down",
                  { fiveDayLow: levels.low5d, below200d: below200, below50d: below50, shortPriority: below200 && below50 ? "urgent" : below200 ? "high" : below50 ? "elevated" : "low" })
              );
            }
          }
        } else if (!isCoolingDown(shortKey, min2ms(cfg.breakCooldownMin))) {
          pendingBreaks.set(shortKey, { level: levels.low5d, framesAbove: 1, direction: "down", meta: {} });
        }
      }
    }
  }
  return signals;
}

// ── Short-side detectors ─────────────────────────────────────────────────────

// Track when tickers were last seen above key break levels (for failed-breakout detection)
const lastAboveBreakLevel = new Map<string, { frame: number; level: number; levelType: "prev_day" | "5day" }>();

function detectFailedBreakout(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];
  const clearance = cfg.failedBreakoutReversalPct / 100;

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0 || tick.prevDayHigh <= 0) continue;

    const levels: Array<{ level: number; label: string; levelType: "prev_day" | "5day" }> = [
      { level: tick.prevDayHigh, label: "prev day high", levelType: "prev_day" },
    ];
    const fiveDay = fiveDayHighLow.get(symbol);
    if (fiveDay) levels.push({ level: fiveDay.high5d, label: "5-day high", levelType: "5day" });

    for (const { level, label, levelType } of levels) {
      const trackKey = `failed_breakout:${symbol}:${levelType}`;

      if (tick.price > level) {
        lastAboveBreakLevel.set(trackKey, { frame: frameSeq, level, levelType });
        continue;
      }

      // Price is now at or below the level — check if it was above recently
      const lastAbove = lastAboveBreakLevel.get(trackKey);
      if (!lastAbove) continue;

      const framesAgo = frameSeq - lastAbove.frame;
      if (framesAgo < cfg.failedBreakoutLookbackMin || framesAgo > cfg.failedBreakoutLookbackMax) continue;

      const reversalPct = ((level - tick.price) / level);
      if (reversalPct < clearance) continue;

      const key = `failed_breakout:${symbol}`;
      if (isCoolingDown(key, min2ms(cfg.failedBreakoutCooldownMin))) continue;

      markFired(key);
      lastAboveBreakLevel.delete(trackKey);

      const below200 = tick.sma200d != null && tick.price < tick.sma200d;
      const below50 = tick.sma50d != null && tick.price < tick.sma50d;
      signals.push(
        makeSignal("failed_breakout", "ticker", symbol,
          Math.round(reversalPct * 10000) / 100,
          "down",
          {
            failedLevel: level,
            levelType: label,
            framesAboveBeforeReversal: framesAgo,
            reversalPct: Math.round(reversalPct * 10000) / 100,
            below200d: below200,
            below50d: below50,
          })
      );
      break; // one signal per ticker per frame
    }
  }
  return signals;
}

// Track when the HOD was last updated per ticker (monotonic frameSeq, not ring length)
const hodFrameTracker = new Map<string, { hodPrice: number; hodFrameSeq: number }>();

function detectHodFade(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0 || tick.todayHigh <= 0) continue;

    const tracker = hodFrameTracker.get(symbol);
    if (!tracker || tick.todayHigh > tracker.hodPrice) {
      hodFrameTracker.set(symbol, { hodPrice: tick.todayHigh, hodFrameSeq: frameSeq });
      continue;
    }

    const framesSinceHod = frameSeq - tracker.hodFrameSeq;
    if (framesSinceHod < cfg.hodFadeMinFramesSinceHod) continue;

    const fadeFromHod = ((tracker.hodPrice - tick.price) / tracker.hodPrice) * 100;
    if (fadeFromHod < cfg.hodFadeMinPct) continue;

    const key = `hod_fade:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.hodFadeCooldownMin))) continue;

    markFired(key);
    const below200 = tick.sma200d != null && tick.price < tick.sma200d;
    const below50 = tick.sma50d != null && tick.price < tick.sma50d;
    signals.push(
      makeSignal("hod_fade", "ticker", symbol,
        Math.round(fadeFromHod * 100) / 100,
        "down",
        {
          hodPrice: tracker.hodPrice,
          fadeFromHodPct: Math.round(fadeFromHod * 100) / 100,
          framesSinceHod,
          below200d: below200,
          below50d: below50,
        })
    );
  }
  return signals;
}

function detectGapDownContinuation(current: SnapshotFrame): Signal[] {
  const signals: Signal[] = [];

  // Need enough wall-clock frames since session start (not ring length — ring caps at 10)
  if (frameSeq < cfg.gapDownContinuationMinFrames) return signals;

  for (const [symbol, tick] of current.tickers) {
    if (tick.price <= 0 || tick.prevClose <= 0 || tick.todayOpen <= 0) continue;

    const gapPct = ((tick.todayOpen - tick.prevClose) / tick.prevClose) * 100;
    if (gapPct > -cfg.gapDownContinuationMinGapPct) continue; // must be a gap DOWN

    const fadeBelowOpen = ((tick.todayOpen - tick.price) / tick.todayOpen) * 100;
    if (fadeBelowOpen < cfg.gapDownContinuationMinFadePct) continue;

    const key = `gap_down_continuation:${symbol}`;
    if (isCoolingDown(key, min2ms(cfg.gapDownContinuationCooldownMin))) continue;

    markFired(key);
    const below200 = tick.sma200d != null && tick.price < tick.sma200d;
    const below50 = tick.sma50d != null && tick.price < tick.sma50d;
    signals.push(
      makeSignal("gap_down_continuation", "ticker", symbol,
        Math.round(Math.abs(gapPct) * 100) / 100,
        "down",
        {
          gapPct: Math.round(gapPct * 100) / 100,
          fadeBelowOpenPct: Math.round(fadeBelowOpen * 100) / 100,
          todayOpen: tick.todayOpen,
          prevClose: tick.prevClose,
          below200d: below200,
          below50d: below50,
        })
    );
  }
  return signals;
}

// ── Post-Earnings Reaction detector ─────────────────────────────────────────

const earningsReactionFiredToday = new Map<string, string>();

async function detectPostEarningsReaction(current: SnapshotFrame): Promise<Signal[]> {
  const signals: Signal[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  for (const [symbol, tick] of current.tickers) {
    if (earningsReactionFiredToday.get(symbol) === today) continue;
    if (Math.abs(tick.changePct) < 3.0) continue;

    const cached = await getCachedEarningsData(symbol);
    if (!cached?.lastEarningsDate) continue;
    if (cached.lastEarningsDate !== today && cached.lastEarningsDate !== yesterday) continue;

    const key = `earnings_reaction:${symbol}`;
    if (isCoolingDown(key, 24 * 60 * 60_000)) continue;

    earningsReactionFiredToday.set(symbol, today);
    markFired(key);

    const epsActual = cached.epsActual;
    const epsEstimate = cached.epsEstimate;
    let epsSurprisePct: number | null = null;
    if (epsActual != null && epsEstimate != null && epsEstimate !== 0) {
      epsSurprisePct = Math.round(((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100);
    }
    const revActual = cached.revenueActual;
    const revEstimate = cached.revenueEstimate;
    let revSurprisePct: number | null = null;
    if (revActual != null && revEstimate != null && revEstimate !== 0) {
      revSurprisePct = Math.round(((revActual - revEstimate) / Math.abs(revEstimate)) * 100);
    }

    signals.push(
      makeSignal("earnings_reaction", "ticker", symbol,
        Math.round(Math.abs(tick.changePct) * 100) / 100,
        tick.changePct >= 0 ? "up" : "down",
        {
          gapPct: Math.round(tick.changePct * 100) / 100,
          epsActual, epsEstimate, epsSurprisePct,
          revenueActual: revActual, revenueEstimate: revEstimate, revenueSurprisePct: revSurprisePct,
          earningsTime: cached.earningsTime,
        })
    );
  }
  return signals;
}

// ── Theme Earnings Density detector ─────────────────────────────────────────

const earningsDensityFiredToday = new Map<string, string>();

async function detectThemeEarningsDensity(current: SnapshotFrame): Promise<Signal[]> {
  const signals: Signal[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const fiveTradingDaysMs = 7 * 24 * 60 * 60_000; // ~5 trading days ≈ 7 calendar days

  for (const cluster of CLUSTERS) {
    if (earningsDensityFiredToday.get(cluster.id) === todayStr) continue;

    const memberSymbols = getClusterTickers(cluster.id);
    const reportingTickers: string[] = [];

    for (const sym of memberSymbols) {
      const cached = await getCachedEarningsData(sym);
      if (!cached?.nextEarningsDate || cached.nextEarningsDate === "N/A") continue;
      const earningsDate = new Date(cached.nextEarningsDate);
      const daysUntil = (earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntil >= 0 && daysUntil <= 5) {
        reportingTickers.push(sym);
      }
    }

    if (reportingTickers.length >= 3) {
      const key = `theme_earnings_density:${cluster.id}`;
      if (isCoolingDown(key, 24 * 60 * 60_000)) continue;

      earningsDensityFiredToday.set(cluster.id, todayStr);
      markFired(key);

      signals.push(
        makeSignal("theme_earnings_density", "theme", cluster.id,
          reportingTickers.length,
          "neutral",
          { reportingTickers, count: reportingTickers.length })
      );
    }
  }
  return signals;
}

// ── Main process function ───────────────────────────────────────────────────

let firstFrameDiagnosticDone = false;

export async function processSnapshot(frame: SnapshotFrame, session?: MarketSession): Promise<Signal[]> {
  pushFrame(frame);

  if (!firstFrameDiagnosticDone) {
    firstFrameDiagnosticDone = true;
    let gapCount = 0;
    let movingCount = 0;
    for (const [, tick] of frame.tickers) {
      if (Math.abs(tick.changePct) >= cfg.gapThresholdPct) gapCount++;
      if (Math.abs(tick.changePct) > 0) movingCount++;
    }
    console.log(
      `[Scanner] First frame diagnostic: ${frame.tickers.size} tickers, ` +
      `${gapCount} with >=${cfg.gapThresholdPct}% gap, ${movingCount} with movement, ` +
      `buffer length: ${ringBuffer.length}, session: ${session ?? "unknown"}`
    );
  }

  const isPreMarket = session === "pre_market";
  const isAfterHours = session === "after_hours";

  const signals: Signal[] = [];

  // volume_spike: runs in all sessions (no prev frame needed)
  signals.push(...detectVolumeSpikes(frame));

  if (isPreMarket) {
    signals.push(...detectGaps(frame));
  } else if (isAfterHours) {
    signals.push(...detectVelocityMoves(frame));
  } else {
    signals.push(...detectVelocityMoves(frame));
    signals.push(...detectAdrBlowouts(frame));
    signals.push(...detectGaps(frame));
    signals.push(...detectBreadthShifts(frame, session));
    signals.push(...detectThemeAccelerations(frame, session));
    signals.push(...detectRegimeChange(frame));
    signals.push(...detectRaiShift(frame));
    signals.push(...detectBroadMoves(frame, session));
    signals.push(...detectLodBounce(frame));
    signals.push(...detectMaReclaim(frame));
    signals.push(...detectMaProximity(frame));
    signals.push(...detectPrevDayBreaks(frame));
    signals.push(...detectFiveDayBreaks(frame));
    signals.push(...detectFailedBreakout(frame));
    signals.push(...detectHodFade(frame));
    signals.push(...detectGapDownContinuation(frame));
    // Earnings detectors (async, cache-only reads)
    const [earningsReactions, earningsDensity] = await Promise.all([
      detectPostEarningsReaction(frame),
      detectThemeEarningsDensity(frame),
    ]);
    signals.push(...earningsReactions, ...earningsDensity);
  }

  if (ringBuffer.length % 60 === 0) {
    pruneCooldowns();
    pruneTrackers();
  }

  if (signals.length > 0) {
    console.log(`[Scanner] Emitted ${signals.length} signal(s) [${session ?? "unknown"}]: ${signals.map(s => `${s.type}:${s.subject}`).join(", ")}`);
  }

  return signals;
}
