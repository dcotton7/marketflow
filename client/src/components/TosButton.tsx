/**
 * ToSLink — calibrate UI for Settings.
 * Drive Thinkorswim from this Windows PC via the local helper (Live or LOCAL).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTosStatus,
  isWindowsClient,
  startTosLinkHelper,
  TOSLINK_DOWNLOAD_HREF,
  TOSLINK_PROTOCOL_START,
  tosCalibrate,
  tosErrorMessage,
  type TosStatus,
} from "@/lib/tos-bridge-client";
import { useTosSyncSafe } from "@/context/TosSyncContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function useTos() {
  const [status, setStatus] = useState<TosStatus>({
    available: false,
    calibrated: false,
    position: null,
    calibratedAt: null,
  });

  const refresh = useCallback(async () => {
    const s = await fetchTosStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const calibrate = useCallback(async () => {
    await tosCalibrate();
    await refresh();
  }, [refresh]);

  return { ...status, calibrate, refresh };
}

export function TosCalibrateButton() {
  const { available, calibrated, position, calibratedAt, calibrate, refresh } = useTos();
  const tosSync = useTosSyncSafe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStartTried = useRef(false);
  const windows = isWindowsClient();

  useEffect(() => {
    if (available) return;
    const id = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(id);
  }, [available, refresh]);

  useEffect(() => {
    if (!windows || available || autoStartTried.current) return;
    autoStartTried.current = true;
    startTosLinkHelper();
  }, [windows, available]);

  async function ensureHelper(): Promise<boolean> {
    if (available) return true;
    startTosLinkHelper();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((r) => window.setTimeout(r, 1000));
      const next = await fetchTosStatus();
      if (next.available) {
        await refresh();
        return true;
      }
    }
    return false;
  }

  async function handleRestart() {
    setBusy(true);
    setError(null);
    try {
      const up = await ensureHelper();
      if (!up) {
        setError("Helper did not start. Allow the browser to open MarketFlow ToSLink, then click Restart helper again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCalibrate() {
    setBusy(true);
    setError(null);
    try {
      if (!available) {
        const up = await ensureHelper();
        if (!up) {
          setError("Helper did not start. Click Restart helper, leave that window open, then Calibrate again.");
          return;
        }
      }
      await calibrate();
      tosSync?.setTosSyncEnabled(true);
      await tosSync?.refreshStatus();
    } catch (err) {
      setError(tosErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ToSLink</CardTitle>
        <CardDescription>
          Thinkorswim is on this PC. Recalibrate at each startup or whenever you move the ToS window.
          This link works if Fidelity is closed. Fidelity is optional and only leads the ticker when that tab is open.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!windows && (
          <p className="text-xs text-muted-foreground">
            ToSLink needs Windows with Thinkorswim open on this machine.
          </p>
        )}
        {windows && !available && (
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              The helper is a small window on this PC. Thinkorswim must already be open. Leave the
              helper window open while you use Charts.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" asChild>
                <a href={TOSLINK_PROTOCOL_START}>Start helper</a>
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <a href={TOSLINK_DOWNLOAD_HREF} download="ToSLink.cmd">
                  Download helper
                </a>
              </Button>
            </div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                First time: click <span className="font-medium text-foreground">Download helper</span>, then
                double-click <span className="font-medium text-foreground">ToSLink.cmd</span>. If Windows
                warns, choose More info → Run anyway.
              </li>
              <li>
                After that: click <span className="font-medium text-foreground">Start helper</span> and allow
                the browser to open MarketFlow ToSLink.
              </li>
              <li>When this card says the helper is running, click Calibrate below.</li>
            </ol>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Advanced (repo on this PC)
              </summary>
              <div className="mt-2 space-y-1">
                <p>
                  <code className="text-foreground">npm run tos-agent</code>
                  {" "}or download these three files into the same folder and run{" "}
                  <span className="font-medium text-foreground">start-tos-agent.cmd</span>.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href="/tos-helper/start-tos-agent.cmd" className="text-emerald-400 hover:underline" download>
                    start-tos-agent.cmd
                  </a>
                  <a href="/tos-helper/tos-agent.ps1" className="text-emerald-400 hover:underline" download>
                    tos-agent.ps1
                  </a>
                  <a href="/tos-helper/tos-win.ps1" className="text-emerald-400 hover:underline" download>
                    tos-win.ps1
                  </a>
                </div>
              </div>
            </details>
          </div>
        )}
        {available && (
          <p className="text-xs text-muted-foreground">
            Click <strong>Calibrate</strong>, then click once on the Thinkorswim{" "}
            <strong>pop-out symbol box</strong> (not Scanner). You have 15 seconds.
          </p>
        )}
        {windows && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Optional: Fidelity Trade+ leads the ticker
            </summary>
            <div className="mt-2 space-y-1">
              <p>
                A click on Fidelity can change MarketFlow and thinkorswim. If Fidelity is down, ToSLink
                still drives thinkorswim from this app.
              </p>
              <p>
                Chrome → Extensions → Load unpacked →{" "}
                <span className="font-medium text-foreground">
                  %LOCALAPPDATA%\MarketFlow\fidelity-lead
                </span>
                . Leave the helper window open.
              </p>
            </div>
          </details>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCalibrate}
            disabled={busy || (!available && !windows)}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? (available ? "Click the ToS symbol box…" : "Starting helper…") : calibrated ? "Recalibrate" : "Calibrate"}
          </button>
          {calibrated && position && (
            <span className="text-xs text-muted-foreground">
              ✓ Locked at ({position.x}, {position.y})
              {calibratedAt && ` · ${new Date(calibratedAt).toLocaleString()}`}
            </span>
          )}
          {windows && !available && (
            <button
              type="button"
              onClick={() => { void handleRestart(); }}
              disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {busy ? "Starting helper…" : "Restart helper"}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
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
  const windows = isWindowsClient();

  if (!tos) return null;
  if (!tos.tosAvailable && !windows) return null;

  const { tosSyncEnabled, setTosSyncEnabled, tosCalibrated, tosAvailable, tosNavigate } = tos;

  function handleClick() {
    if (!tosAvailable) {
      toast({
        title: "ToSLink helper is not running",
        description: "Click Start if you installed it before. First time: Settings → ToSLink → Download helper.",
        variant: "destructive",
        action: (
          <ToastAction altText="Start helper" onClick={() => startTosLinkHelper()}>
            Start
          </ToastAction>
        ),
      });
      return;
    }
    if (!tosCalibrated) {
      toast({
        title: "ToSLink not calibrated",
        description: "Settings → ToSLink: click Calibrate, then click the ToS pop-out symbol box.",
        variant: "destructive",
      });
      return;
    }
    const next = !tosSyncEnabled;
    setTosSyncEnabled(next);
    if (next) {
      if (currentSymbol) void tosNavigate(currentSymbol);
      toast({
        title: "ToSLink On",
        description: "Ticker changes on Flow and Charts drive Thinkorswim",
      });
    }
  }

  const tooltip = !tosAvailable
    ? "Start the ToSLink helper on this PC (Settings → ToSLink), then Calibrate"
    : tosCalibrated
      ? tosSyncEnabled
        ? "ToSLink is on — Flow and Charts share this switch"
        : "Turn on ToSLink for Flow and Charts"
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
              tosSyncEnabled && tosAvailable
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
            )}
          >
            ToSLink
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
          variant={tosSyncEnabled && tosAvailable ? "default" : "outline"}
          className="gap-1.5"
          onClick={handleClick}
          data-testid="button-chart-tos"
        >
          ToSLink
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
