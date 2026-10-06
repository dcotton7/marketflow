/**
 * Sliding one-minute call budget for Alpaca options requests.
 * Calls over budget are refused (not queued) so a burst cannot crowd out the stock pollers.
 */

export class OptionsBudgetError extends Error {
  constructor(budgetName: string, limit: number) {
    super(`Options call budget exceeded (${budgetName}: ${limit}/min)`);
    this.name = "OptionsBudgetError";
  }
}

export class CallBudget {
  private stamps: number[] = [];
  private total = 0;

  constructor(
    readonly name: string,
    readonly limitPerMin: number
  ) {}

  private prune(now: number): void {
    const cutoff = now - 60_000;
    while (this.stamps.length > 0 && this.stamps[0] <= cutoff) this.stamps.shift();
  }

  used(now = Date.now()): number {
    this.prune(now);
    return this.stamps.length;
  }

  tryTake(now = Date.now()): boolean {
    this.prune(now);
    if (this.stamps.length >= this.limitPerMin) return false;
    this.stamps.push(now);
    this.total++;
    return true;
  }

  take(now = Date.now()): void {
    if (!this.tryTake(now)) throw new OptionsBudgetError(this.name, this.limitPerMin);
  }

  stats(now = Date.now()): { name: string; limitPerMin: number; usedLastMinute: number; totalSinceStart: number } {
    return { name: this.name, limitPerMin: this.limitPerMin, usedLastMinute: this.used(now), totalSinceStart: this.total };
  }
}

export function budgetLimitFromEnv(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}
