/**
 * Retry with exponential backoff — wraps async functions that call external APIs.
 *
 * Usage:
 *   const data = await retryWithBackoff(() => fetchFromFMP(url), { label: "FMP profile" });
 */

export interface RetryOptions {
  maxRetries?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "label" | "shouldRetry">> = {
  maxRetries: 3,
  baseMs: 500,
  maxMs: 8000,
};

function isTransient(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err).toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("econnrefused")) return true;
  if (msg.includes("503") || msg.includes("502") || msg.includes("504")) return true;
  if (msg.includes("fetch failed") || msg.includes("network")) return true;
  // Don't retry auth failures or 4xx client errors
  if (msg.includes("401") || msg.includes("403") || msg.includes("404")) return false;
  return true;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
  const baseMs = opts?.baseMs ?? DEFAULT_OPTIONS.baseMs;
  const maxMs = opts?.maxMs ?? DEFAULT_OPTIONS.maxMs;
  const shouldRetry = opts?.shouldRetry ?? isTransient;
  const label = opts?.label ?? "API call";

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        break;
      }

      const jitter = Math.random() * 0.3 + 0.85; // 0.85–1.15x
      const delayMs = Math.min(maxMs, baseMs * Math.pow(2, attempt) * jitter);

      if (attempt >= 1) {
        console.warn(`[Retry] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${Math.round(delayMs)}ms`);
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
