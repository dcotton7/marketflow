/**
 * Memory Gate — pressure check for heavy background tasks.
 *
 * Render kills on process RSS (2GB plan), not V8 heap. Gates must watch both:
 * heap pressure (V8) and RSS % of budget (what actually OOMs the instance).
 *
 * Night mode (8:00 PM – 4:00 AM ET, weekends): pause MA chains, daily-bar
 * refresh, and outcome-tracker backlog work so overnight RSS can settle.
 */

const HEAP_LIMIT_MB = parseInt(process.env.HEAP_LIMIT_MB || "1024", 10);
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

export function startMemoryLogging(intervalMs = 60_000): void {
  if (memoryLogInterval) return;

  memoryLogInterval = setInterval(() => {
    const snap = getMemorySnapshot();
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
      `Peak: ${snap.peakHeapMB}MB heap, ${snap.peakRssMB}MB RSS` +
      (flags ? ` ⚠️ ${flags}` : "");
    if (snap.pressureHigh) {
      console.warn(msg);
    } else {
      console.log(msg);
    }
  }, intervalMs);

  console.log(
    `[Memory] Periodic logging started (every ${intervalMs / 1000}s, ` +
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
