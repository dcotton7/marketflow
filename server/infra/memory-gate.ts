/**
 * Memory Gate — pressure check for heavy background tasks.
 *
 * Render kills on process RSS (2GB plan), not V8 heap. Gates must watch both:
 * heap pressure (V8) and RSS % of budget (what actually OOMs the instance).
 *
 * Night mode (8:00 PM – 4:00 AM ET, weekends): pause MA chains, daily-bar
 * refresh, and outcome-tracker backlog work so overnight RSS can settle.
 */

import { readFileSync } from "fs";

const HEAP_LIMIT_MB = parseInt(process.env.HEAP_LIMIT_MB || "1536", 10);
const RSS_BUDGET_MB = parseInt(process.env.RSS_BUDGET_MB || "2048", 10);
/** Heap fraction of HEAP_LIMIT_MB that counts as pressure. */
const HEAP_PRESSURE_THRESHOLD = 0.70;
/** RSS fraction of RSS_BUDGET_MB that counts as pressure (~1.47GB on 2GB). */
const RSS_PRESSURE_THRESHOLD = 0.72;

const ET = "America/New_York";
/** Night mode: [8:00 PM ET, 4:00 AM ET) and weekends. */
const NIGHT_START_MINUTES = 20 * 60;
const NIGHT_END_MINUTES = 4 * 60;

let memoryLogInterval: ReturnType<typeof setInterval> | null = null;
let peakHeapMB = 0;
let peakRssMB = 0;

function getEtParts(anchor: Date = new Date()): { day: number; mins: number } {
  const etNow = new Date(anchor.toLocaleString("en-US", { timeZone: ET }));
  return {
    day: etNow.getDay(),
    mins: etNow.getHours() * 60 + etNow.getMinutes(),
  };
}

/** True Fri 8pm ET through Mon 4am ET, and every night 8pm–4am. */
export function isNightMode(anchor: Date = new Date()): boolean {
  const { day, mins } = getEtParts(anchor);
  if (day === 0 || day === 6) return true;
  return mins >= NIGHT_START_MINUTES || mins < NIGHT_END_MINUTES;
}

export function getNightModeWindow(): {
  startEt: string;
  endEt: string;
  active: boolean;
} {
  return {
    startEt: "20:00",
    endEt: "04:00",
    active: isNightMode(),
  };
}

export function isMemoryPressureHigh(): boolean {
  const mem = process.memoryUsage();
  const heapMB = mem.heapUsed / (1024 * 1024);
  const rssMB = mem.rss / (1024 * 1024);
  return (
    heapMB > HEAP_LIMIT_MB * HEAP_PRESSURE_THRESHOLD ||
    rssMB > RSS_BUDGET_MB * RSS_PRESSURE_THRESHOLD
  );
}

/** Heavy background work: MA chains, daily-bar refresh, outcome backfill. */
export function shouldRunHeavyBackgroundWork(): boolean {
  return !isNightMode() && !isMemoryPressureHigh();
}

export function getMemorySnapshot() {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024));
  const heapTotalMB = Math.round(mem.heapTotal / (1024 * 1024));
  const rssMB = Math.round(mem.rss / (1024 * 1024));
  const externalMB = Math.round(mem.external / (1024 * 1024));
  const nightMode = isNightMode();

  if (heapUsedMB > peakHeapMB) peakHeapMB = heapUsedMB;
  if (rssMB > peakRssMB) peakRssMB = rssMB;

  const heapPressure = heapUsedMB > HEAP_LIMIT_MB * HEAP_PRESSURE_THRESHOLD;
  const rssPressure = rssMB > RSS_BUDGET_MB * RSS_PRESSURE_THRESHOLD;

  return {
    heapUsedMB,
    heapTotalMB,
    rssMB,
    externalMB,
    heapLimitMB: HEAP_LIMIT_MB,
    rssBudgetMB: RSS_BUDGET_MB,
    heapPct: Math.round((heapUsedMB / HEAP_LIMIT_MB) * 100),
    rssPct: Math.round((rssMB / RSS_BUDGET_MB) * 1000) / 10,
    peakHeapMB,
    peakRssMB,
    heapPressure,
    rssPressure,
    pressureHigh: heapPressure || rssPressure,
    nightMode,
    allowHeavyWork: !nightMode && !(heapPressure || rssPressure),
  };
}

/**
 * Background work that is running now, by name, so a memory line (and the last line before a kill) says what was
 * running. trackJob(name) at the start, call the returned function at the end; a name can run more than once at a time.
 */
const runningJobs = new Map<string, { count: number; since: number }>();

export function trackJob(name: string): () => void {
  const cur = runningJobs.get(name);
  if (cur) cur.count++;
  else runningJobs.set(name, { count: 1, since: Date.now() });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const e = runningJobs.get(name);
    if (!e) return;
    if (--e.count <= 0) runningJobs.delete(name);
  };
}

/** "name 12s, other x2 3s" (oldest first), or "none". */
export function runningJobsLine(now = Date.now()): string {
  if (runningJobs.size === 0) return "none";
  return [...runningJobs.entries()]
    .sort((a, b) => a[1].since - b[1].since)
    .map(([n, e]) => `${n}${e.count > 1 ? ` x${e.count}` : ""} ${Math.round((now - e.since) / 1000)}s`)
    .join(", ");
}

/** RssAnon / RssFile from /proc/self/status (Linux only; null elsewhere): anonymous memory vs mapped files. */
function procRss(): { anonMB: number; fileMB: number } | null {
  try {
    const txt = readFileSync("/proc/self/status", "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(txt)?.[1] ?? NaN);
    const anon = kb("RssAnon");
    const file = kb("RssFile");
    if (!Number.isFinite(anon) || !Number.isFinite(file)) return null;
    return { anonMB: Math.round(anon / 1024), fileMB: Math.round(file / 1024) };
  } catch {
    return null;
  }
}

/** RSS rise between two samples (10 s apart) that is logged at once, with what was running. */
const RSS_JUMP_LOG_MB = 150;
const SAMPLE_MS = 10_000;

/**
 * The [Memory] line every `intervalMs`, plus an immediate line when RSS rises by RSS_JUMP_LOG_MB or more within one
 * 10 s sample. Besides heap used it shows heap total (what V8 holds), external and array buffers (Buffers), RSS split
 * into anonymous and file-backed, and the background jobs running, so the line before an OOM kill names the suspect.
 */
export function startMemoryLogging(intervalMs = 60_000): void {
  if (memoryLogInterval) return;

  const mb = (n: number) => Math.round(n / (1024 * 1024));
  const sampleMs = Math.min(SAMPLE_MS, intervalMs);
  let lastLogAt = 0;
  let lastSampleRss = 0;
  const logLine = (why: string | null) => {
    const snap = getMemorySnapshot();
    const mem = process.memoryUsage();
    const proc = procRss();
    const flags = [
      snap.pressureHigh ? "PRESSURE" : null,
      snap.rssPressure ? "RSS" : null,
      snap.heapPressure ? "HEAP" : null,
      snap.nightMode ? "NIGHT" : null,
    ]
      .filter(Boolean)
      .join("+");
    const msg =
      `[Memory] Heap: ${snap.heapUsedMB}/${snap.heapLimitMB}MB (${snap.heapPct}%) | ` +
      `RSS: ${snap.rssMB}/${snap.rssBudgetMB}MB (${snap.rssPct}%) | ` +
      `Peak: ${snap.peakHeapMB}MB heap, ${snap.peakRssMB}MB RSS | ` +
      `heapTotal ${mb(mem.heapTotal)}MB, external ${mb(mem.external)}MB, arrayBuffers ${mb(mem.arrayBuffers)}MB` +
      (proc ? `, rssAnon ${proc.anonMB}MB, rssFile ${proc.fileMB}MB` : "") +
      ` | jobs: ${runningJobsLine()}` +
      (why ? ` | ${why}` : "") +
      (flags ? ` ⚠️ ${flags}` : "");
    lastLogAt = Date.now();
    if (snap.pressureHigh || why) {
      console.warn(msg);
    } else {
      console.log(msg);
    }
  };

  memoryLogInterval = setInterval(() => {
    const rss = mb(process.memoryUsage().rss);
    const jump = lastSampleRss > 0 ? rss - lastSampleRss : 0;
    lastSampleRss = rss;
    if (jump >= RSS_JUMP_LOG_MB) {
      logLine(`RSS JUMP +${jump}MB in ${sampleMs / 1000}s`);
    } else if (Date.now() - lastLogAt >= intervalMs - sampleMs / 2) {
      logLine(null);
    }
  }, sampleMs);
  memoryLogInterval.unref?.();

  console.log(
    `[Memory] Periodic logging started (every ${intervalMs / 1000}s, and at once on an RSS rise of ${RSS_JUMP_LOG_MB}MB+ in ${SAMPLE_MS / 1000}s; ` +
      `heapLimit=${HEAP_LIMIT_MB}MB@${HEAP_PRESSURE_THRESHOLD * 100}%, ` +
      `rssBudget=${RSS_BUDGET_MB}MB@${RSS_PRESSURE_THRESHOLD * 100}%, ` +
      `night=${NIGHT_START_MINUTES / 60}:00–${String(NIGHT_END_MINUTES / 60).padStart(2, "0")}:00 ET)`
  );
}

export function stopMemoryLogging(): void {
  if (memoryLogInterval) {
    clearInterval(memoryLogInterval);
    memoryLogInterval = null;
  }
}
