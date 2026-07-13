/**
 * Memory Gate — lightweight heap pressure check for task scheduling.
 *
 * Heavy background tasks (daily bar refresh, fundamentals backfill) call
 * isMemoryPressureHigh() before each batch. If the heap is above the
 * threshold, they pause or skip to avoid OOMing the process while MC
 * snapshot polling is running concurrently.
 *
 * Also provides periodic memory logging and a health endpoint payload.
 */

const HEAP_LIMIT_MB = parseInt(process.env.HEAP_LIMIT_MB || "1792", 10);
const PRESSURE_THRESHOLD = 0.70; // 70% of heap limit = pressure

let memoryLogInterval: ReturnType<typeof setInterval> | null = null;
let peakHeapMB = 0;
let peakRssMB = 0;

export function isMemoryPressureHigh(): boolean {
  const mem = process.memoryUsage();
  const heapMB = mem.heapUsed / (1024 * 1024);
  return heapMB > HEAP_LIMIT_MB * PRESSURE_THRESHOLD;
}

export function getMemorySnapshot() {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024));
  const heapTotalMB = Math.round(mem.heapTotal / (1024 * 1024));
  const rssMB = Math.round(mem.rss / (1024 * 1024));
  const externalMB = Math.round(mem.external / (1024 * 1024));

  if (heapUsedMB > peakHeapMB) peakHeapMB = heapUsedMB;
  if (rssMB > peakRssMB) peakRssMB = rssMB;

  return {
    heapUsedMB,
    heapTotalMB,
    rssMB,
    externalMB,
    heapLimitMB: HEAP_LIMIT_MB,
    heapPct: Math.round((heapUsedMB / HEAP_LIMIT_MB) * 100),
    peakHeapMB,
    peakRssMB,
    pressureHigh: heapUsedMB > HEAP_LIMIT_MB * PRESSURE_THRESHOLD,
  };
}

export function startMemoryLogging(intervalMs = 60_000): void {
  if (memoryLogInterval) return;

  memoryLogInterval = setInterval(() => {
    const snap = getMemorySnapshot();
    const level = snap.pressureHigh ? "warn" : "log";
    const msg = `[Memory] Heap: ${snap.heapUsedMB}/${snap.heapLimitMB}MB (${snap.heapPct}%) | RSS: ${snap.rssMB}MB | Peak: ${snap.peakHeapMB}MB heap, ${snap.peakRssMB}MB RSS`;
    if (level === "warn") {
      console.warn(msg + " ⚠️ PRESSURE HIGH");
    } else {
      console.log(msg);
    }
  }, intervalMs);

  console.log(`[Memory] Periodic logging started (every ${intervalMs / 1000}s, limit=${HEAP_LIMIT_MB}MB, threshold=${PRESSURE_THRESHOLD * 100}%)`);
}

export function stopMemoryLogging(): void {
  if (memoryLogInterval) {
    clearInterval(memoryLogInterval);
    memoryLogInterval = null;
  }
}
