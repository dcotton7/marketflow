import { MARKET_BASE, TRADER_BASE } from "./config";
import type { TokenManager } from "./auth";

/**
 * Schwab REST, read only. The client has one request method and it sends GET: there is no way to place, change or
 * cancel an order from here (schwab.test.ts checks this file and the rest of server/schwab/).
 */
export const BUDGET_PER_MIN = 100;
const RETRIES = 3;

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SchwabHttpError extends Error {
  constructor(public status: number, path: string) {
    super(`Schwab ${status} on ${path}`);
  }
}

export interface RestDeps {
  fetchImpl?: Fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class SchwabRest {
  private sent: number[] = [];
  private fetchImpl: Fetch;
  private wait: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private tokens: TokenManager, private userId: number, deps: RestDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.wait = deps.wait ?? sleep;
    this.now = deps.now ?? Date.now;
  }

  /** Client-side budget: at most BUDGET_PER_MIN requests in any 60 s. */
  private async takeSlot(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.sent = this.sent.filter((s) => t - s < 60_000);
      if (this.sent.length < BUDGET_PER_MIN) {
        this.sent.push(t);
        return;
      }
      await this.wait(60_000 - (t - this.sent[0]) + 5);
    }
  }

  /** GET with backoff: 429 and 5xx retried 3 times (1, 2, 4 s or Retry-After); a 401 refreshes the token once. */
  async get<T = any>(base: string, path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
    const url = `${base}${path}${q.toString() ? `?${q}` : ""}`;
    let forced = false;
    for (let attempt = 0; ; attempt++) {
      await this.takeSlot();
      const token = await this.tokens.accessToken(this.userId, { force: forced });
      const res = await this.fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !forced) {
        forced = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        const after = Number(res.headers.get("retry-after"));
        await this.wait(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new SchwabHttpError(res.status, path);
    }
  }

  accountNumbers() {
    return this.get<Array<{ accountNumber: string; hashValue: string }>>(TRADER_BASE, "/accounts/accountNumbers");
  }
  accounts() {
    return this.get<SchwabAccount[]>(TRADER_BASE, "/accounts", { fields: "positions" });
  }
  orders(accountHash: string, fromIso: string, toIso: string) {
    return this.get<any[]>(TRADER_BASE, `/accounts/${encodeURIComponent(accountHash)}/orders`, { fromEnteredTime: fromIso, toEnteredTime: toIso });
  }
  transactions(accountHash: string, startIso: string, endIso: string, types = "TRADE") {
    return this.get<any[]>(TRADER_BASE, `/accounts/${encodeURIComponent(accountHash)}/transactions`, { startDate: startIso, endDate: endIso, types });
  }
  userPreference() {
    return this.get<{ streamerInfo?: StreamerInfo[] }>(TRADER_BASE, "/userPreference");
  }
  async quotes(symbols: string[]): Promise<SchwabQuote[]> {
    if (!symbols.length) return [];
    const raw = await this.get<Record<string, any>>(MARKET_BASE, "/quotes", { symbols: symbols.join(",") });
    return quotesFrom(raw);
  }
  priceHistory(symbol: string, p: { periodType?: string; period?: number; frequencyType?: string; frequency?: number; startDate?: number; endDate?: number; needExtendedHoursData?: boolean } = {}) {
    return this.get<{ symbol: string; empty: boolean; candles: Array<{ open: number; high: number; low: number; close: number; volume: number; datetime: number }> }>(
      MARKET_BASE, "/pricehistory", { symbol, ...p });
  }
}

export interface StreamerInfo {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

export interface SchwabAccount {
  securitiesAccount: {
    type?: string;
    accountNumber: string;
    positions?: Array<{
      shortQuantity?: number;
      longQuantity?: number;
      averagePrice?: number;
      averageLongPrice?: number;
      averageShortPrice?: number;
      marketValue?: number;
      currentDayProfitLoss?: number;
      instrument: { assetType?: string; symbol?: string; description?: string };
    }>;
    currentBalances?: Record<string, number>;
  };
}

export interface SchwabQuote {
  symbol: string;
  last: number;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  netChange: number | null;
  volume: number | null;
  realtime: boolean | null;
  quoteTime: number | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function quotesFrom(raw: Record<string, any>): SchwabQuote[] {
  const out: SchwabQuote[] = [];
  for (const [symbol, row] of Object.entries(raw ?? {})) {
    const q = row?.quote;
    const last = num(q?.lastPrice) ?? num(q?.mark);
    if (!q || last === null) continue;
    out.push({
      symbol: symbol.toUpperCase(), last, bid: num(q.bidPrice), ask: num(q.askPrice), open: num(q.openPrice),
      high: num(q.highPrice), low: num(q.lowPrice), prevClose: num(q.closePrice), netChange: num(q.netChange),
      volume: num(q.totalVolume), realtime: typeof row.realtime === "boolean" ? row.realtime : null,
      quoteTime: num(q.quoteTime) ?? num(q.tradeTime),
    });
  }
  return out;
}

/** Equities and ETFs only; options, cash and money funds are skipped. */
const SYNCED_TYPES = new Set(["EQUITY", "COLLECTIVE_INVESTMENT", "ETF"]);
const mask = (acct: string) => `…${String(acct).slice(-4)}`;

export interface SchwabPosition {
  symbol: string;
  shares: number; // positive; side says long or short
  side: "long" | "short";
  averagePrice: number | null;
  marketValue: number | null;
  dayPnl: number | null;
  assetType: string;
  accounts: string[]; // masked, last 4 digits
}

/** Positions across every linked account, summed by symbol and side, average price weighted by quantity. */
export function positionsFrom(accounts: SchwabAccount[]): SchwabPosition[] {
  const by = new Map<string, SchwabPosition & { cost: number }>();
  for (const a of accounts ?? []) {
    const acct = a.securitiesAccount;
    for (const p of acct?.positions ?? []) {
      const type = String(p.instrument?.assetType ?? "").toUpperCase();
      const symbol = String(p.instrument?.symbol ?? "").toUpperCase();
      if (!symbol || !SYNCED_TYPES.has(type)) continue;
      for (const side of ["long", "short"] as const) {
        const qty = num(side === "long" ? p.longQuantity : p.shortQuantity) ?? 0;
        if (qty <= 0) continue;
        const avg = num(side === "long" ? p.averageLongPrice : p.averageShortPrice) ?? num(p.averagePrice);
        const key = `${symbol}:${side}`;
        const cur = by.get(key) ?? { symbol, shares: 0, side, averagePrice: null, marketValue: 0, dayPnl: 0, assetType: type, accounts: [], cost: 0 };
        cur.shares += qty;
        cur.cost += (avg ?? 0) * qty;
        cur.averagePrice = cur.shares > 0 && cur.cost > 0 ? Math.round((cur.cost / cur.shares) * 10_000) / 10_000 : null;
        cur.marketValue = (cur.marketValue ?? 0) + (num(p.marketValue) ?? 0);
        cur.dayPnl = (cur.dayPnl ?? 0) + (num(p.currentDayProfitLoss) ?? 0);
        if (!cur.accounts.includes(mask(acct.accountNumber))) cur.accounts.push(mask(acct.accountNumber));
        by.set(key, cur);
      }
    }
  }
  return [...by.values()].map(({ cost: _c, ...p }) => p).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const BALANCE_KEYS = ["liquidationValue", "cashBalance", "availableFunds", "buyingPower", "equity", "longMarketValue", "shortMarketValue", "dayTradingBuyingPower"];

export function balancesFrom(accounts: SchwabAccount[]) {
  return (accounts ?? []).map((a) => {
    const b = a.securitiesAccount?.currentBalances ?? {};
    const picked: Record<string, number> = {};
    for (const k of BALANCE_KEYS) if (typeof b[k] === "number") picked[k] = b[k];
    return { account: mask(a.securitiesAccount.accountNumber), type: a.securitiesAccount.type ?? null, ...picked };
  });
}
