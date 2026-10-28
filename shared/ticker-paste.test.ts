import assert from "node:assert/strict";
import { cleanSymbol, parseNumber, parseTickerPaste, pastePreview } from "./ticker-paste";

const symbols = (text: string) => parseTickerPaste(text).tickers.map((t) => t.symbol);

// 1. Schwab.com Positions table, selected and copied: tabs, a header, money cells, an option, totals and cash.
const schwabPositions = [
  "Symbol\tDescription\tQty (Quantity)\tPrice\tPrice Chng $ (Price Change $)\tPrice Chng % (Price Change %)\tMkt Val (Market Value)\tCost Basis\tGain $ (Gain/Loss $)\tGain % (Gain/Loss %)",
  "NVDA\tNVIDIA CORP\t100\t$181.20\t+2.31\t+1.29%\t$18,120.00\t$14,500.00\t$3,620.00\t24.97%",
  "BRK/B\tBERKSHIRE HATHAWAY INC CL B\t10\t$470.10\t-1.20\t-0.25%\t$4,701.00\t$4,000.00\t$701.00\t17.53%",
  "AMD\tADVANCED MICRO DEVICES INC\t50\t$140.00\t(2.10)\t(1.48%)\t$7,000.00\t$7,500.00\t($500.00)\t(6.67%)",
  "NVDA 01/16/2026 200.00 C\tCALL NVIDIA CORP $200 EXP 01/16/26\t2\t$5.10\t--\t--\t$1,020.00\t$800.00\t$220.00\t27.5%",
  "Cash & Cash Investments\t--\t--\t--\t--\t--\t$2,000.00\t--\t--\t--",
  "Positions Total\t\t\t\t\t\t$32,841.00\t\t\t",
  "Account Total\t\t\t\t\t\t$34,841.00\t\t\t",
].join("\n");
const p = parseTickerPaste(schwabPositions);
assert.deepEqual(p.tickers.map((t) => t.symbol), ["NVDA", "BRK.B", "AMD"], "never CORP, INC, CL, B or C");
assert.deepEqual(p.tickers[0], { symbol: "NVDA", option: null, shares: 100, entry: 145 }, "cost basis over quantity");
assert.equal(p.tickers[2].entry, 150);
const dupOption = p.skipped.find((s) => s.text.startsWith("NVDA 01/16"));
assert.equal(dupOption?.why, "duplicate", "the option's underlying is already in");
assert.equal(p.skipped.filter((s) => s.why === "total or cash").length, 3);
assert.equal(pastePreview(p), "3 found, 5 skipped (1 header, 1 duplicate, 3 total or cash)");

// 2. Schwab CSV export: a title line, a blank line, quoted header and rows.
const schwabCsv = [
  '"Positions for account Individual ...123 as of 03:45 PM ET, 10/28/2026"',
  "",
  '"Symbol","Description","Quantity","Price","Price Change %","Market Value","Cost Basis","Security Type"',
  '"MSFT","MICROSOFT CORP","20","$420.00","0.5%","$8,400.00","$7,000.00","Equity"',
  '"BRK B","BERKSHIRE HATHAWAY INC CL B","5","$470.10","-0.25%","$2,350.50","$2,000.00","Equity"',
  '"Cash & Cash Investments","--","--","--","--","$500.00","--","Cash and Money Market"',
  '"Account Total","--","--","--","--","$11,250.50","$9,000.00","--"',
].join("\n");
const c = parseTickerPaste(schwabCsv);
assert.deepEqual(c.tickers.map((t) => [t.symbol, t.shares, t.entry]), [["MSFT", 20, 350], ["BRK.B", 5, 400]]);

// 3. thinkorswim watchlist copy: tabs, symbol first, a tos option code.
const tos = [
  "Symbol\tLast\tNet Chng\tVolume\tBid\tAsk",
  "AAPL\t230.10\t+1.20\t50,123,456\t230.09\t230.11",
  "/ES\t5,900.25\t+10.00\t1,234\t5,900.00\t5,900.50",
  ".NVDA260116C200\t5.10\t+0.40\t1,200\t5.00\t5.20",
  "SPY\t580.00\t-0.50\t70,000,000\t579.99\t580.01",
].join("\n");
const t = parseTickerPaste(tos);
assert.deepEqual(t.tickers.map((x) => x.symbol), ["AAPL", "NVDA", "SPY"]);
assert.equal(t.tickers[1].option, ".NVDA260116C200", "marked as from an option");
assert.equal(t.skipped.find((s) => s.text === "/ES")?.why, "not a ticker", "futures aren't stocks");

// 4. Plain lists, a space-separated Schwab row, share classes and a Schwab option line.
assert.deepEqual(symbols("AAPL, MSFT\n$nvda\nbrk-b\nBRK B\nGOOGL"), ["AAPL", "MSFT", "NVDA", "BRK.B", "GOOGL"]);
assert.deepEqual(symbols("NVDA  NVIDIA CORP  $181.20  +2.31  100  $18,120.00"), ["NVDA"], "not CORP");
assert.deepEqual(symbols("NVDA 01/16/2026 200.00 C"), ["NVDA"], "not C (Citigroup)");
assert.equal(parseTickerPaste("NVDA 01/16/2026 200.00 C").tickers[0].option, "NVDA 01/16/2026 200.00 C");
assert.deepEqual(symbols("AAPL MSFT TSLA"), ["AAPL", "MSFT", "TSLA"]);
assert.deepEqual(symbols("Symbol\nPrice\nQty"), [], "header words alone are not tickers");
assert.deepEqual(symbols("NVDA  260116C00200000"), ["NVDA"], "an OCC option code");
assert.equal(pastePreview(parseTickerPaste("AAPL\naapl\nTOOLONG")), "1 found, 2 skipped (1 duplicate, 1 not a ticker)");

assert.deepEqual(cleanSymbol("$brk/b"), { symbol: "BRK.B", option: null });
assert.equal(parseNumber("($1,234.50)"), -1234.5);
assert.equal(parseNumber("--"), null);
assert.equal(parseNumber("+2.31%"), 2.31);

console.log("ticker paste ok");
