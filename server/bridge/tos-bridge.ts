/**
 * ToS (Thinkorswim) Bridge — drive a ToS chart (including pop-outs) via
 * window targeting + keystroke injection.
 *
 * How it works:
 *   1. CALIBRATE — user hovers the ToS symbol box (main or pop-out). We
 *      capture the mouse position only if that point is on Thinkorswim.
 *   2. NAVIGATE  — raise the ToS window that contains those coords, click,
 *      type the ticker, Enter. Abort before Ctrl+A if the click would
 *      hit Scanner/browser (that was selecting all chart cells).
 *
 * LOCAL Windows only. Live / production returns 501.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const exec = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT = path.join(__dirname, "tos-win.ps1");

interface Calibration {
  x: number;
  y: number;
  calibratedAt: string;
  process?: string;
  title?: string;
}

interface PsResult {
  ok?: boolean;
  error?: string;
  x?: number;
  y?: number;
  process?: string;
  title?: string;
  symbol?: string;
}

const CAL_FILE = path.join(process.cwd(), "data", "tos-calibration.json");
let calibration: Calibration | null = null;

function loadCalibration(): Calibration | null {
  try {
    if (fs.existsSync(CAL_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CAL_FILE, "utf-8"));
      if (typeof raw.x === "number" && typeof raw.y === "number") {
        calibration = raw;
        return calibration;
      }
    }
  } catch {
    /* ignore corrupt file */
  }
  return null;
}

function saveCalibration(cal: Calibration): void {
  const dir = path.dirname(CAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CAL_FILE, JSON.stringify(cal, null, 2));
  calibration = cal;
}

loadCalibration();

const IS_WINDOWS = process.platform === "win32";

function parsePsJson(stdout: string): PsResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"));
  const last = lines[lines.length - 1];
  if (!last) throw new Error("ToS bridge returned no result");
  return JSON.parse(last) as PsResult;
}

async function runTosPs(args: string[]): Promise<PsResult> {
  try {
    const { stdout } = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, ...args],
      { windowsHide: true, timeout: 30000 },
    );
    return parsePsJson(stdout);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (e.stdout) {
      try {
        const parsed = parsePsJson(e.stdout);
        if (parsed.error) return parsed;
      } catch {
        /* fall through */
      }
    }
    const detail = (e.stdout || e.stderr || e.message || "PowerShell failed").toString().trim();
    throw new Error(detail.slice(0, 400));
  }
}

export function isAvailable(): boolean {
  return IS_WINDOWS && process.env.NODE_ENV !== "production";
}

export function getStatus(): {
  available: boolean;
  calibrated: boolean;
  position: { x: number; y: number } | null;
  calibratedAt: string | null;
  process: string | null;
  title: string | null;
} {
  return {
    available: isAvailable(),
    calibrated: calibration !== null,
    position: calibration ? { x: calibration.x, y: calibration.y } : null,
    calibratedAt: calibration?.calibratedAt ?? null,
    process: calibration?.process ?? null,
    title: calibration?.title ?? null,
  };
}

export async function calibrate(_delaySec: number = 5): Promise<Calibration> {
  if (!IS_WINDOWS) throw new Error("ToS bridge requires Windows");

  const result = await runTosPs(["-Action", "calibrate"]);
  if (!result.ok || typeof result.x !== "number" || typeof result.y !== "number") {
    throw new Error(result.error || "Calibration failed");
  }

  const cal: Calibration = {
    x: result.x,
    y: result.y,
    calibratedAt: new Date().toISOString(),
    process: result.process,
    title: result.title,
  };
  saveCalibration(cal);
  console.log(`[ToS Bridge] Calibrated at (${cal.x}, ${cal.y}) on ${cal.process ?? "?"} "${cal.title ?? ""}"`);
  return cal;
}

export async function navigate(symbol: string): Promise<void> {
  if (!IS_WINDOWS) throw new Error("ToS bridge requires Windows");
  if (!calibration) throw new Error("Not calibrated — click the ToS pop-out symbol box and calibrate first");

  const clean = symbol.toUpperCase().replace(/[^A-Z0-9./-]/g, "");
  if (!clean) throw new Error("Invalid symbol");

  const { x, y } = calibration;
  const result = await runTosPs([
    "-Action",
    "navigate",
    "-Symbol",
    clean,
    "-X",
    String(x),
    "-Y",
    String(y),
  ]);
  if (!result.ok) {
    throw new Error(result.error || "Navigate failed");
  }
  console.log(`[ToS Bridge] Navigated to ${clean} via ${result.process ?? "thinkorswim"}`);
}
