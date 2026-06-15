import {
  buildDailyCashByBroker,
  buildDailyInvestedPct,
  buildInvestedPctSnapshot,
  buildDailyPositionValue,
} from "@shared/trade-journal-invested";

const trades = [
  { brokerId: "FIDELITY", tradeDate: "2026-01-02", direction: "BUY", ticker: "AAPL", quantity: 100, price: 200 },
  { brokerId: "FIDELITY", tradeDate: "2026-01-10", direction: "SELL", ticker: "AAPL", quantity: 50, price: 210 },
];

const cashRows = [
  { brokerId: "FIDELITY", tradeDate: "2026-01-02", accountName: "Acct", rawSource: 'x,x,x,x,x,x,"$80,000.00"' },
  { brokerId: "FIDELITY", tradeDate: "2026-01-10", accountName: "Acct", rawSource: 'x,x,x,x,x,x,"$90,500.00"' },
];

function cashFromRow(row: { rawSource: string | null }) {
  const m = row.rawSource?.match(/"([^"]+)"/);
  if (!m) return null;
  return parseFloat(m[1]!.replace(/[$,]/g, ""));
}

const cashByBroker = buildDailyCashByBroker(cashRows, cashFromRow);
const pos = buildDailyPositionValue(trades, "FIDELITY");
const pct = buildDailyInvestedPct(trades, cashByBroker);
const snap = buildInvestedPctSnapshot(pct.FIDELITY);

console.log({ pos, pct: pct.FIDELITY, snap });
