/**
 * Circuit Breaker — protects against cascading failures from external services.
 *
 * States:
 *   CLOSED  — normal operation, requests pass through
 *   OPEN    — too many failures, requests are rejected immediately
 *   HALF_OPEN — after cooldown, one probe request is allowed through
 *
 * Usage:
 *   const fmpBreaker = new CircuitBreaker("FMP", { failureThreshold: 5 });
 *   const data = await fmpBreaker.call(() => fetchFromFMP(url));
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxProbes?: number;
}

const DEFAULTS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxProbes: 1,
};

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private openedAt: Date | null = null;
  private halfOpenProbes = 0;
  private opts: Required<CircuitBreakerOptions>;
  private onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(name: string, opts?: CircuitBreakerOptions, onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void) {
    this.name = name;
    this.opts = { ...DEFAULTS, ...opts };
    this.onStateChange = onStateChange;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureAt?.toISOString() ?? null,
      lastSuccess: this.lastSuccessAt?.toISOString() ?? null,
      openedAt: this.openedAt?.toISOString() ?? null,
    };
  }

  isAvailable(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt?.getTime() ?? 0);
      if (elapsed >= this.opts.resetTimeoutMs) {
        this.transition("half_open");
        return true;
      }
      return false;
    }
    // half_open — allow limited probes
    return this.halfOpenProbes < this.opts.halfOpenMaxProbes;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error(`[CircuitBreaker:${this.name}] OPEN — request rejected`);
    }

    if (this.state === "half_open") {
      this.halfOpenProbes++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccessAt = new Date();

    if (this.state === "half_open") {
      this.transition("closed");
      this.failures = 0;
      this.halfOpenProbes = 0;
    } else if (this.state === "closed") {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = new Date();

    if (this.state === "half_open") {
      this.transition("open");
      this.halfOpenProbes = 0;
    } else if (this.state === "closed" && this.failures >= this.opts.failureThreshold) {
      this.transition("open");
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    if (to === "open") {
      this.openedAt = new Date();
      console.error(`[CircuitBreaker:${this.name}] ⚡ OPENED after ${this.failures} failures`);
    } else if (to === "half_open") {
      this.halfOpenProbes = 0;
      console.log(`[CircuitBreaker:${this.name}] 🔄 HALF_OPEN — probing...`);
    } else if (to === "closed") {
      console.log(`[CircuitBreaker:${this.name}] ✅ CLOSED — service recovered`);
    }

    this.onStateChange?.(this.name, from, to);
  }

  /** Force reset (e.g., after config change or manual intervention) */
  reset(): void {
    this.failures = 0;
    this.halfOpenProbes = 0;
    if (this.state !== "closed") {
      this.transition("closed");
    }
  }
}

// ── Global registry ────────────────────────────────────────────────────────

const registry = new Map<string, CircuitBreaker>();

export function getOrCreateBreaker(
  name: string,
  opts?: CircuitBreakerOptions,
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void
): CircuitBreaker {
  let breaker = registry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, opts, onStateChange);
    registry.set(name, breaker);
  }
  return breaker;
}

export function getAllBreakerStatuses() {
  return Array.from(registry.values()).map((b) => b.getStatus());
}
