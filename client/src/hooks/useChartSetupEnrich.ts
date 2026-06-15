import { useCallback, useRef, useState } from "react";
import type { ChartSetupEnrichDossier, ChartSetupEnrichResult } from "@shared/chart-setup-enrich";

const ENRICH_CACHE_REV = 8;

function mergeResultWithDossier(
  result: ChartSetupEnrichResult,
  dossier: ChartSetupEnrichDossier
): ChartSetupEnrichResult {
  const b = dossier.baseMeta;
  const u = dossier.urMeta;
  let recommendation = result.recommendation;
  if (u?.buyableNow && u.summaryLines[0]) {
    recommendation = recommendation
      .replace(/pattern is unclear[^.]*\.?\s*/gi, "")
      .replace(/no distinct base or breakout pattern[^.]*\.?\s*/gi, "")
      .trim();
    const lower = recommendation.toLowerCase();
    if (
      !lower.includes("u&r") ||
      /unclear|no distinct|coiling for a potential/i.test(lower)
    ) {
      recommendation = `${u.summaryLines[0]}. Textbook ${u.maLabel ?? "MA"} undercut-and-rally — buyable on today's reclaim.`;
    }
  } else if (b?.detected && b.summaryLines[0]) {
    const lower = recommendation.toLowerCase();
    const powerLine = b.summaryLines.find((l) => l.startsWith("Power setup:"));
    if (powerLine && !recommendation.includes(powerLine.slice(0, 20))) {
      recommendation = `${powerLine}. ${recommendation}`;
    } else if (!lower.includes("base") && !lower.includes("consolidat")) {
      recommendation = `${b.summaryLines[0]}. ${recommendation}`;
    } else if (b.reclaim200d?.justOnLastBar && !lower.includes("200") && !lower.includes("reclaim")) {
      const reclaimLine = b.summaryLines.find((l) => l.includes("reclaims the 200d"));
      if (reclaimLine) recommendation = `${reclaimLine}. ${recommendation}`;
    }
  }
  return {
    ...result,
    recommendation,
    baseMeta: b?.detected ? b : result.baseMeta,
    urMeta: u?.detected ? u : result.urMeta,
    structureMeta: dossier.structureMeta ?? result.structureMeta,
    patternLabel: u?.buyableNow ? "undercut_rally" : result.patternLabel,
    lifecycleStage: u?.buyableNow ? "triggering" : result.lifecycleStage,
  };
}
import type {
  ChartEnrichFeedbackInput,
  ChartEnrichModelInput,
} from "@shared/chart-setup-enrich";
import { resolveTradingDayKey } from "@shared/theme-daily-watchlist";
import { buildChartEnrichStatusSteps } from "@/lib/chart-enrich-status";

export interface ChartEnrichCacheEntry {
  result: ChartSetupEnrichResult;
  enrichRunId: number | null;
  dossier: ChartSetupEnrichDossier;
}

export function useChartSetupEnrich() {
  const cacheRef = useRef<Map<string, ChartEnrichCacheEntry>>(new Map());
  const tradingDayKey = resolveTradingDayKey();
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState(false);
  const [enrichErrorMessage, setEnrichErrorMessage] = useState<string | null>(null);
  const [enrichStatusLog, setEnrichStatusLog] = useState<string[]>([]);
  const enrichStatusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enrichStatusDoneRef = useRef(false);

  const cacheKey = useCallback(
    (symbol: string, includeVisual: boolean) =>
      `${tradingDayKey}:${symbol.toUpperCase()}:r${ENRICH_CACHE_REV}:v${includeVisual ? 1 : 0}`,
    [tradingDayKey]
  );

  const getCached = useCallback(
    (symbol: string, includeVisual: boolean) => {
      return cacheRef.current.get(cacheKey(symbol, includeVisual)) ?? null;
    },
    [cacheKey]
  );

  const stopStatusPlayback = useCallback(() => {
    if (enrichStatusTimerRef.current) {
      clearInterval(enrichStatusTimerRef.current);
      enrichStatusTimerRef.current = null;
    }
  }, []);

  const flushStatusSteps = useCallback(
    (steps: string[], extra?: string) => {
      const lines = extra ? [...steps, extra] : [...steps];
      setEnrichStatusLog(lines);
    },
    []
  );

  const startStatusPlayback = useCallback(
    (steps: string[]) => {
      stopStatusPlayback();
      enrichStatusDoneRef.current = false;
      let idx = 0;
      const push = () => {
        if (idx >= steps.length) return;
        const line = steps[idx];
        idx += 1;
        setEnrichStatusLog((prev) => [...prev, line]);
      };
      push();
      enrichStatusTimerRef.current = setInterval(() => {
        if (enrichStatusDoneRef.current) {
          flushStatusSteps(steps);
          stopStatusPlayback();
          return;
        }
        if (idx >= steps.length - 1) return;
        push();
      }, 650);
    },
    [flushStatusSteps, stopStatusPlayback]
  );

  const enrich = useCallback(
    async (dossier: ChartSetupEnrichDossier): Promise<ChartEnrichCacheEntry> => {
      const key = cacheKey(dossier.symbol, dossier.includeVisual);
      const hit = cacheRef.current.get(key);
      if (hit) {
        return {
          ...hit,
          dossier,
          result: mergeResultWithDossier(hit.result, dossier),
        };
      }

      const statusSteps = buildChartEnrichStatusSteps(dossier);
      setEnriching(true);
      setEnrichError(false);
      setEnrichErrorMessage(null);
      setEnrichStatusLog([]);
      startStatusPlayback(statusSteps);
      try {
        const res = await fetch("/api/sentinel/chart-setup-enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dossier }),
        });
        if (!res.ok) {
          let detail = "";
          try {
            const errBody = await res.json();
            detail =
              typeof errBody?.error === "string"
                ? errBody.error
                : typeof errBody?.message === "string"
                  ? errBody.message
                  : "";
          } catch {
            /* ignore */
          }
          if (res.status === 404) {
            throw new Error(
              "Enrich API not found (404). Restart npm run dev locally, or deploy latest code to Live."
            );
          }
          if (res.status === 401) {
            throw new Error(detail || "Unauthorized — log into Sentinel and retry.");
          }
          throw new Error(detail || `Enrich failed (${res.status})`);
        }
        const data = await res.json();
        if (!data?.result?.recommendation) {
          throw new Error("Enrich returned an empty result");
        }
        const entry: ChartEnrichCacheEntry = {
          result: mergeResultWithDossier(data.result, dossier),
          enrichRunId: data.enrichRunId ?? null,
          dossier,
        };
        cacheRef.current.set(key, entry);
        enrichStatusDoneRef.current = true;
        const similar = typeof data.similarModelsUsed === "number" ? data.similarModelsUsed : 0;
        flushStatusSteps(
          statusSteps,
          similar > 0
            ? `Complete — applied ${similar} similar setup model${similar === 1 ? "" : "s"}.`
            : "Complete — fresh LLM read (no similar models matched)."
        );
        return entry;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Enrich failed";
        setEnrichError(true);
        setEnrichErrorMessage(msg);
        enrichStatusDoneRef.current = true;
        setEnrichStatusLog((prev) => [...prev, `Failed — ${msg}`]);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        stopStatusPlayback();
        setEnriching(false);
      }
    },
    [cacheKey, flushStatusSteps, startStatusPlayback, stopStatusPlayback]
  );

  const invalidate = useCallback(
    (symbol: string) => {
      for (const k of cacheRef.current.keys()) {
        if (k.includes(`:${symbol.toUpperCase()}:`)) cacheRef.current.delete(k);
      }
    },
    []
  );

  const parseApiError = async (res: Response, fallback: string) => {
    try {
      const body = await res.json();
      if (typeof body?.error === "string") return body.error;
      if (typeof body?.message === "string") return body.message;
    } catch {
      /* ignore */
    }
    return `${fallback} (${res.status})`;
  };

  const submitFeedback = useCallback(async (input: ChartEnrichFeedbackInput) => {
    const res = await fetch("/api/sentinel/chart-setup-enrich/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await parseApiError(res, "Feedback failed"));
    return res.json() as Promise<{ ok: boolean; feedbackId: number | null }>;
  }, []);

  const saveModel = useCallback(async (input: ChartEnrichModelInput) => {
    const res = await fetch("/api/sentinel/chart-setup-enrich/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await parseApiError(res, "Model save failed"));
    return res.json() as Promise<{ ok: boolean; modelId: number | null }>;
  }, []);

  return {
    enriching,
    enrichError,
    enrichErrorMessage,
    enrichStatusLog,
    enrich,
    getCached,
    invalidate,
    submitFeedback,
    saveModel,
  };
}
