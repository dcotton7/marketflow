/**
 * ToS Bridge — calibrate UI for Settings.
 * Global sync toggle lives in TosSyncContext + Flow "Choose OnClick Action".
 */

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useTosSyncSafe } from "@/context/TosSyncContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TosStatus {
  available: boolean;
  calibrated: boolean;
  position: { x: number; y: number } | null;
  calibratedAt: string | null;
}

async function fetchTosStatus(): Promise<TosStatus> {
  const res = await fetch("/api/tos/status", { credentials: "include" });
  if (!res.ok) return { available: false, calibrated: false, position: null, calibratedAt: null };
  return res.json();
}

async function tosCalibrateApi(): Promise<void> {
  await apiRequest("POST", "/api/tos/calibrate");
}

function calibrateErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      /* use raw */
    }
  }
  return raw.replace(/^\d+:\s*/, "");
}

export function useTos() {
  const [status, setStatus] = useState<TosStatus>({
    available: false,
    calibrated: false,
    position: null,
    calibratedAt: null,
  });

  useEffect(() => {
    fetchTosStatus().then(setStatus).catch(() => {});
  }, []);

  const calibrate = useCallback(async () => {
    await tosCalibrateApi();
    const s = await fetchTosStatus();
    setStatus(s);
  }, []);

  return { ...status, calibrate };
}

export function TosCalibrateButton() {
  const { available, calibrated, position, calibratedAt, calibrate } = useTos();
  const tosSync = useTosSyncSafe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) return null;

  async function handleCalibrate() {
    setBusy(true);
    setError(null);
    try {
      await calibrate();
      await tosSync?.refreshStatus();
    } catch (err) {
      setError(calibrateErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <h4 className="text-sm font-medium text-foreground">ToS Bridge</h4>
      <p className="text-xs text-muted-foreground">
        Click <strong>Calibrate</strong>, then click once on the Thinkorswim <strong>pop-out
        symbol box</strong> (not Scanner). You have 15 seconds. Then turn on <strong>ToS</strong> on
        Charts or Flow — one switch, shared everywhere.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCalibrate}
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Click the ToS symbol box…" : "Calibrate"}
        </button>
        {calibrated && position && (
          <span className="text-xs text-muted-foreground">
            ✓ Locked at ({position.x}, {position.y})
            {calibratedAt && ` · ${new Date(calibratedAt).toLocaleString()}`}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Global ToS on/off — same setting on Flow and Charts (including pop-outs). */
export function TosSyncToggle({
  appearance = "toolbar",
  currentSymbol,
}: {
  appearance?: "chip" | "toolbar";
  currentSymbol?: string;
}) {
  const tos = useTosSyncSafe();
  const { toast } = useToast();

  if (!tos?.tosAvailable) return null;

  const { tosSyncEnabled, setTosSyncEnabled, tosCalibrated, tosNavigate } = tos;

  function handleClick() {
    if (!tosCalibrated) {
      toast({
        title: "ToS not calibrated",
        description: "Settings → ToS Bridge: click Calibrate, then click the ToS pop-out symbol box.",
        variant: "destructive",
      });
      return;
    }
    const next = !tosSyncEnabled;
    setTosSyncEnabled(next);
    if (next) {
      if (currentSymbol) void tosNavigate(currentSymbol);
      toast({
        title: "ToS Sync On",
        description: "Ticker changes on Flow and Charts drive Thinkorswim",
      });
    }
  }

  const tooltip = tosCalibrated
    ? tosSyncEnabled
      ? "ToS driving is on — Flow and Charts share this switch"
      : "Turn on ToS driving for Flow and Charts"
    : "Calibrate first in Settings on the ToS pop-out symbol box";

  if (appearance === "chip") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            data-testid="button-flow-tos"
            className={cn(
              "text-xs px-3 py-1 rounded transition-colors flex items-center",
              tosSyncEnabled
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
            )}
          >
            ToS
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={tosSyncEnabled ? "default" : "outline"}
          className="gap-1.5"
          onClick={handleClick}
          data-testid="button-chart-tos"
        >
          ToS
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
