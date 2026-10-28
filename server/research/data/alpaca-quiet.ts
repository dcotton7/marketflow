import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The app's Alpaca client logs every request and swallows multi-symbol page errors into console.error. The research
 * loader calls it thousands of times, so each call runs with those lines captured: noise is dropped, and a captured
 * error marks the batch as failed (so a partial series is never cached as complete). Console is patched once while
 * any call is in flight; errors go to the calling context, so concurrent calls don't mix them up.
 */
const ctx = new AsyncLocalStorage<string[]>();
let depth = 0;
let orig: { log: typeof console.log; warn: typeof console.warn; error: typeof console.error } | null = null;

function isAlpacaNoise(args: unknown[]): boolean {
  const first = typeof args[0] === "string" ? args[0] : "";
  return first.startsWith("[Alpaca]") || first.startsWith("  - ");
}

function patch() {
  orig = { log: console.log, warn: console.warn, error: console.error };
  const o = orig;
  const capture = (fallback: (...a: unknown[]) => void) => (...args: unknown[]) => {
    const errors = ctx.getStore();
    if (errors && isAlpacaNoise(args)) errors.push(args.map(String).join(" ").slice(0, 300));
    else fallback(...args);
  };
  console.log = (...args: unknown[]) => {
    if (ctx.getStore() && isAlpacaNoise(args)) return;
    o.log(...args);
  };
  console.warn = capture(o.warn);
  console.error = capture(o.error);
}

export async function withQuietAlpaca<T>(fn: () => Promise<T>): Promise<{ result: T; errors: string[] }> {
  if (depth++ === 0) patch();
  const errors: string[] = [];
  try {
    const result = await ctx.run(errors, fn);
    return { result, errors };
  } finally {
    if (--depth === 0 && orig) {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
      orig = null;
    }
  }
}
