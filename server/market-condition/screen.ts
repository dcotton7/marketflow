/**
 * R7 adapter: collects the live theme rows from the in-memory snapshot (no Alpaca, no bars, no entry gauges) and joins
 * them to the daily summary map. The rules and the field list are in screen-core.ts.
 */
import { getEtClock } from "@shared/usEquityMarketSession";
import { CLUSTER_IDS } from "./universe";
import { getClusterLeaderCandidates, getClusterMembers, getTickerSnapshot } from "./engine/snapshot";
import { getThemeTickerSymbols } from "./utils/theme-db-loader";
import { getSummaryMap } from "./daily-summary";
import { buildRows, dropStale, runScreen, type LiveSym, type ScreenAnswer, type ScreenQuery } from "./screen-core";
import { getUsEquityMarketSession } from "@shared/usEquityMarketSession";

function collectLive(): LiveSym[] {
  const bySym = new Map<string, LiveSym>();
  for (const id of CLUSTER_IDS) {
    const leaders = new Set(getClusterLeaderCandidates(id).filter((l) => l.isLeader).map((l) => l.symbol.toUpperCase()));
    for (const m of getClusterMembers(id)) {
      const sym = m.symbol.toUpperCase();
      const have = bySym.get(sym);
      if (have) {
        if (!have.themeIds.includes(id)) have.themeIds.push(id);
        continue;
      }
      const snap = getTickerSnapshot(m.symbol);
      if (!snap || !(snap.price > 0)) continue;
      bySym.set(sym, {
        symbol: sym,
        themeIds: [id],
        price: snap.price,
        prevClose: snap.prevClose,
        changePct: snap.changePct,
        vwap: snap.vwap > 0 ? snap.vwap : null,
        dayHigh: snap.high,
        dayLow: snap.low,
        volume: snap.volume,
        prevDayHigh: snap.prevDayHigh ?? null,
        prevDayLow: snap.prevDayLow ?? null,
        avgVolume20D: snap.avgVolume20D ?? null,
        pctVsEma10d: m.pctVsEma10d ?? null,
        pctVsEma20d: m.pctVsEma20d ?? null,
        pctVsSma20d: m.pctVsSma20d ?? null,
        pctVsSma50d: m.pctVsSma50d ?? null,
        pctVsSma200d: m.pctVsSma200d ?? null,
        trendState: m.trendState,
        rsRank: m.rsRank > 0 ? m.rsRank : null,
        isLeader: leaders.has(sym),
        snapshotAt: new Date(snap.timestamp).toISOString(),
        etDate: getEtClock(new Date(snap.timestamp)).dateKey,
      });
    }
  }
  return [...bySym.values()];
}

function themeMap(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of CLUSTER_IDS) {
    for (const s of getThemeTickerSymbols(id)) {
      const u = s.toUpperCase();
      out.set(u, [...(out.get(u) ?? []), id]);
    }
  }
  return out;
}

export async function screen(db: any, q: ScreenQuery): Promise<ScreenAnswer & { staleExcluded: number; asOf: string; session: string; liveNames: number; eodNames: number; summaryAsOf: string | null; note: string | null }> {
  const { kept: summaries, dropped } = dropStale(await getSummaryMap(db));
  const live = collectLive();
  const themes = themeMap();
  const rows = buildRows(live, summaries, (s) => themes.get(s) ?? []);
  const answer = runScreen(rows, q);
  let newest: string | null = null;
  for (const s of summaries.values()) if (!newest || s.asOf > newest) newest = s.asOf;
  const now = new Date();
  return {
    asOf: now.toISOString(),
    session: getUsEquityMarketSession(now),
    ...answer,
    liveNames: live.length,
    eodNames: rows.length - live.length,
    summaryAsOf: newest,
    staleExcluded: dropped,
    note: summaries.size === 0 ? "the daily summary is not built yet: only live theme names are served" : null,
  };
}
