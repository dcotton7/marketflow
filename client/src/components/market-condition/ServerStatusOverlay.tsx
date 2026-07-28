import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERVER_STATUS_OVERLAY_Z_INDEX } from "@/lib/overlay-z-index";

const STORAGE_KEY = "marketflow:serverStatusOverlay";
const POLL_MS = 1000;
const TICK_MS = 250;

type ServerStatusPayload = {
  generatedAt: string;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    rssBudgetMb: number;
    rssPctOfBudget: number;
  };
  polling: {
    isPolling: boolean;
    currentIntervalMs: number;
    marketSession: string;
    lastUpdate: string | null;
    errorCount: number;
    tickerCount: number;
    themeCount: number;
  };
  sleep: {
    isSleeping: boolean;
  };
  ma: {
    asOf: string | null;
    mode: string;
    coverage: number;
    universeSize: number;
    shard: {
      inFlight: boolean;
      isPausing?: boolean;
      shardCount: number;
      shardIntervalMs: number;
      batchPauseMs?: number;
      nextShardIndex: number;
      lastShardIndex: number;
      lastShardStartedAt: string | null;
      lastShardFinishedAt: string | null;
      lastShardElapsedMs: number | null;
      lastChainElapsedMs?: number | null;
      lastShardRequested: number;
      lastShardComputed: number;
      universeSize: number;
      batchSize: number;
      coveredCount: number;
      msUntilNextShard: number | null;
    };
  };
  dailyBars?: {
    lastAttempt: string | null;
    lastSuccess: string | null;
    apiKeyBroken: boolean;
    refreshInProgress: boolean;
  } | null;
  scanner?: {
    mode: string;
    lastSignalAt: string | null;
    activePipelines: number;
    universeSize: number;
  } | null;
  deadTickers?: {
    schedule: string;
    lastRunAt: string | null;
    lastDurationMs: number | null;
    lastUniverseSize: number;
    lastCutoffDate: string | null;
    lastMissingFriday: string[];
    lastRemoved: string[];
    lastError: string | null;
    inProgress: boolean;
    nextRunHint: string;
    delistedCount: number;
  } | null;
};

function formatEtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}

function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "idle" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-400"
      : tone === "warn"
        ? "bg-amber-400"
        : tone === "bad"
          ? "bg-red-400"
          : "bg-slate-500";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", cls)} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px] leading-snug">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-200 text-right font-mono tabular-nums">{children}</span>
    </div>
  );
}

export function ServerStatusTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          open
            ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300"
            : "border-slate-600/50 bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:border-slate-500/60"
        )}
        title="Server status"
        aria-label="Open server status"
        data-ui-region="marketFlow:serverStatusTrigger"
      >
        <Activity className="h-3.5 w-3.5" />
      </button>
      {open && <ServerStatusOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function ServerStatusOverlay({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ServerStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [scanStarting, setScanStarting] = useState(false);
  const [pos, setPos] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { x: number; y: number };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
      }
    } catch {
      /* ignore */
    }
    return { x: 16, y: 72 };
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fetchGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const gen = ++fetchGen.current;
      try {
        const res = await fetch(`/api/market-condition/server-status?t=${Date.now()}`, {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ServerStatusPayload;
        if (!cancelled && gen === fetchGen.current) {
          setStatus(json);
          setError(null);
          setNowMs(Date.now());
        }
      } catch (err) {
        if (!cancelled && gen === fetchGen.current) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    };
    load();
    const pollId = window.setInterval(load, POLL_MS);
    const tickId = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, []);

  const runDeadTickerScan = useCallback(async () => {
    if (scanStarting || status?.deadTickers?.inProgress) return;
    setScanStarting(true);
    try {
      const res = await fetch("/api/market-condition/dead-ticker-scan", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed to start");
    } finally {
      setScanStarting(false);
    }
  }, [scanStarting, status?.deadTickers?.inProgress]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const next = {
      x: Math.max(8, e.clientX - dragRef.current.dx),
      y: Math.max(8, e.clientY - dragRef.current.dy),
    };
    setPos(next);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  const shard = status?.ma.shard;
  const elapsedSec = (() => {
    if (!shard?.lastShardStartedAt) return null;
    if (shard.inFlight) {
      return Math.max(0, Math.round((nowMs - new Date(shard.lastShardStartedAt).getTime()) / 1000));
    }
    if (shard.lastChainElapsedMs != null) return Math.round(shard.lastChainElapsedMs / 1000);
    if (shard.lastShardElapsedMs != null) return Math.round(shard.lastShardElapsedMs / 1000);
    return null;
  })();
  const nextCycleSec = (() => {
    if (!shard || shard.inFlight) return null;
    if (shard.msUntilNextShard != null) {
      return Math.max(0, Math.ceil(shard.msUntilNextShard / 1000));
    }
    const interval = shard.shardIntervalMs || 60_000;
    const baseIso = shard.lastShardFinishedAt ?? shard.lastShardStartedAt;
    if (baseIso) {
      return Math.max(0, Math.ceil((interval - (nowMs - new Date(baseIso).getTime())) / 1000));
    }
    return null;
  })();
  const updatedAgeSec = status?.generatedAt
    ? Math.max(0, Math.round((nowMs - new Date(status.generatedAt).getTime()) / 1000))
    : null;

  const rssTone: "ok" | "warn" | "bad" | "idle" = !status
    ? "idle"
    : status.memory.rssPctOfBudget >= 90
      ? "bad"
      : status.memory.rssPctOfBudget >= 75
        ? "warn"
        : "ok";

  const maTone: "ok" | "warn" | "bad" | "idle" = !status
    ? "idle"
    : status.ma.coverage >= status.ma.universeSize * 0.85
      ? "ok"
      : status.ma.coverage > 0
        ? "warn"
        : "bad";

  return createPortal(
    <div
      ref={panelRef}
      className="fixed w-[300px] rounded-lg border border-slate-600/70 bg-slate-950/95 shadow-xl backdrop-blur-sm"
      style={{
        left: pos.x,
        top: pos.y,
        zIndex: SERVER_STATUS_OVERLAY_Z_INDEX,
        isolation: "isolate",
      }}
      data-ui-region="marketFlow:serverStatusOverlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-700/60 px-2 py-1.5 cursor-grab active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-200">Server status</div>
          <div className="text-[10px] text-slate-500 tabular-nums">
            {updatedAgeSec == null
              ? "connecting…"
              : updatedAgeSec <= 1
                ? "live"
                : `updated ${updatedAgeSec}s ago`}
          </div>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={onClose}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 px-2.5 py-2.5" data-no-drag>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        {!status && !error && <p className="text-[11px] text-slate-500">Loading…</p>}

        {status && (
          <>
            <section className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <Dot tone={maTone === "idle" ? "idle" : maTone} />
                MA refresh
              </div>
              <Row label="Cycle start">
                {formatEtTime(shard?.lastShardStartedAt)} ET
                {elapsedSec != null ? ` · ${elapsedSec}s` : ""}
              </Row>
              <Row label="Batch">
                {shard
                  ? `${shard.lastShardComputed}/${shard.lastShardRequested}` +
                    (shard.lastShardIndex >= 0
                      ? ` · ${shard.lastShardIndex + 1}/${shard.shardCount}`
                      : "") +
                    (shard.inFlight
                      ? shard.isPausing
                        ? " · pause 2s"
                        : " · running"
                      : "")
                  : "—"}
              </Row>
              <Row label="Coverage">
                {status.ma.coverage}/{status.ma.universeSize}
                {shard?.inFlight
                  ? ""
                  : nextCycleSec != null
                    ? ` · next ${nextCycleSec}s`
                    : ""}
              </Row>
              <Row label="Batch size">
                {shard?.batchSize ?? "—"} × {shard?.shardCount ?? 5}
                {shard?.batchPauseMs != null ? ` · ${shard.batchPauseMs / 1000}s gap` : " · 2s gap"}
              </Row>
            </section>

            <section className="space-y-1 border-t border-slate-800 pt-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <Dot tone={rssTone === "idle" ? "idle" : rssTone} />
                Memory
              </div>
              <Row label="RSS">
                {status.memory.rssMb} / {status.memory.rssBudgetMb} MB ({status.memory.rssPctOfBudget}%)
              </Row>
              <Row label="Heap">
                {status.memory.heapUsedMb} / {status.memory.heapTotalMb} MB
              </Row>
            </section>

            <section className="space-y-1 border-t border-slate-800 pt-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <Dot
                  tone={
                    status.sleep.isSleeping
                      ? "idle"
                      : status.polling.errorCount > 0
                        ? "warn"
                        : status.polling.isPolling
                          ? "ok"
                          : "bad"
                  }
                />
                Market Condition
              </div>
              <Row label="Poll">
                {status.polling.isPolling ? "on" : "off"} · {Math.round(status.polling.currentIntervalMs / 1000)}s
              </Row>
              <Row label="Last snap">{formatAge(status.polling.lastUpdate)}</Row>
              <Row label="Universe">
                {status.polling.tickerCount} tickers · {status.polling.themeCount} themes
              </Row>
              <Row label="Sleep">{status.sleep.isSleeping ? "yes" : "no"}</Row>
            </section>

            <section className="space-y-1 border-t border-slate-800 pt-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <Dot
                  tone={
                    status.dailyBars?.apiKeyBroken
                      ? "bad"
                      : status.dailyBars?.refreshInProgress
                        ? "warn"
                        : "ok"
                  }
                />
                Daily bars
              </div>
              <Row label="Last OK">{formatAge(status.dailyBars?.lastSuccess)}</Row>
              <Row label="State">
                {status.dailyBars?.apiKeyBroken
                  ? "API key broken"
                  : status.dailyBars?.refreshInProgress
                    ? "refreshing"
                    : "idle"}
              </Row>
            </section>

            {status.scanner && (
              <section className="space-y-1 border-t border-slate-800 pt-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                  <Dot tone={status.scanner.mode === "on" ? "ok" : status.scanner.mode === "silent" ? "warn" : "idle"} />
                  Scanner
                </div>
                <Row label="Mode">{status.scanner.mode}</Row>
                <Row label="Last signal">{formatAge(status.scanner.lastSignalAt)}</Row>
                <Row label="Pipelines">{status.scanner.activePipelines}</Row>
              </section>
            )}

            {status.deadTickers && (
              <section className="space-y-1 border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                    <Dot
                      tone={
                        status.deadTickers.lastError
                          ? "bad"
                          : status.deadTickers.inProgress
                            ? "warn"
                            : status.deadTickers.lastMissingFriday.length > 0
                              ? "warn"
                              : status.deadTickers.lastRunAt
                                ? "ok"
                                : "idle"
                      }
                    />
                    Dead tickers
                  </div>
                  <button
                    type="button"
                    data-no-drag
                    disabled={scanStarting || status.deadTickers.inProgress}
                    onClick={() => void runDeadTickerScan()}
                    className="h-5 rounded border border-slate-600/70 px-1.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    {status.deadTickers.inProgress || scanStarting ? "Running…" : "Run now"}
                  </button>
                </div>
                <Row label="Schedule">{status.deadTickers.schedule}</Row>
                <Row label="Next">{status.deadTickers.nextRunHint}</Row>
                <Row label="Last run">
                  {status.deadTickers.inProgress
                    ? "scanning…"
                    : `${formatAge(status.deadTickers.lastRunAt)}${
                        status.deadTickers.lastDurationMs != null
                          ? ` · ${Math.round(status.deadTickers.lastDurationMs / 1000)}s`
                          : ""
                      }`}
                </Row>
                <Row label="Cutoff">{status.deadTickers.lastCutoffDate ?? "—"}</Row>
                <Row label="Missing">
                  {status.deadTickers.lastMissingFriday.length === 0
                    ? "0"
                    : `${status.deadTickers.lastMissingFriday.length}: ${status.deadTickers.lastMissingFriday.slice(0, 6).join(", ")}${
                        status.deadTickers.lastMissingFriday.length > 6 ? "…" : ""
                      }`}
                </Row>
                <Row label="Removed">
                  {status.deadTickers.lastRemoved.length === 0
                    ? "0"
                    : `${status.deadTickers.lastRemoved.length}: ${status.deadTickers.lastRemoved.slice(0, 6).join(", ")}${
                        status.deadTickers.lastRemoved.length > 6 ? "…" : ""
                      }`}
                </Row>
                <Row label="Registry">{status.deadTickers.delistedCount}</Row>
                {status.deadTickers.lastError ? (
                  <p className="text-[10px] text-red-400 leading-snug">{status.deadTickers.lastError}</p>
                ) : null}
              </section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
