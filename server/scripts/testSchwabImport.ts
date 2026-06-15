import { detectSchwabCsvType } from "@shared/schwab-csv";
import { parseSchwabCSV, parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";

const SAMPLE = `Transactions for account XXXX-1234 as of 02/15/2026 10:00:00 ET
From 01/01/2026 to 02/15/2026

Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
01/26/2026,Buy,AAPL,AAPL,100,220.50,$0.00,"$22,050.00"
02/01/2026,Sell,TSLA,TSLA,50,350.75,$0.00,"$17,537.50"
02/02/2026,Deposit,Cash,Cash Deposit,0,0,$0.00,$5000.00
`;

if (detectSchwabCsvType(SAMPLE) !== "TRANSACTIONS") {
  console.error("detectSchwabCsvType failed on sample Transactions export");
  process.exit(1);
}

const result = parseSchwabCSV(SAMPLE, "History_Transactions.csv", "test");
console.log({
  status: result.batch.status,
  imported: result.batch.totalTradesImported,
  skipped: result.batch.skippedRows.length,
  trades: result.trades.map((t) => ({
    ticker: t.ticker,
    direction: t.direction,
    qty: t.quantity,
    date: t.tradeDate,
    account: t.accountName,
  })),
});

if (result.batch.totalTradesImported !== 2) {
  console.error("Expected 2 trades");
  process.exit(1);
}

const RGL_SAMPLE = `Schwab IRA Realized Gain and Loss Details
Symbol,Description,Quantity,Date Acquired,Date Sold,Cost Basis,Proceeds,Gain/Loss
AAPL,AAPL INC,100,01/15/2024,02/01/2026,"$15,000.00","$22,050.00","$7,050.00"
TSLA,TESLA INC,50,Various,02/15/2026,"$8,000.00","$17,537.50","$9,537.50"
`;

if (detectSchwabCsvType(RGL_SAMPLE) !== "REALIZED_GAIN_LOSS") {
  console.error("detectSchwabCsvType failed on Realized Gain/Loss sample");
  process.exit(1);
}

const rglResult = parseSchwabRealizedGainLossCSV(
  RGL_SAMPLE,
  "Schwab_IRA_Realized_Gain_and_Loss_Details_20230827_08371009.csv",
  "test"
);
console.log({
  rglStatus: rglResult.batch.status,
  rglImported: rglResult.batch.totalTradesImported,
  rglTrades: rglResult.trades.map((t) => ({
    ticker: t.ticker,
    direction: t.direction,
    qty: t.quantity,
    date: t.tradeDate,
  })),
});

// AAPL buy+sell + TSLA sell only (Various acquired date) = 3 trades
if (rglResult.batch.totalTradesImported !== 3) {
  console.error("Expected 3 trades from Realized Gain/Loss sample");
  process.exit(1);
}

const RGL_SCHWAB_WEB = `Schwab IRA GainLoss Realized Details
Symbol,Description,Quantity,Closed Date,Proceeds,Cost Basis (CB),Gain/Loss ($),Short Term Gain/Loss,Long Term Gain/Loss,Disallowed Loss
AAPL,AAPL INC,100,02/01/2026,"$22,050.00","$15,000.00","$7,050.00","$7,050.00",$0.00,$0.00
MSFT,MICROSOFT,25,03/15/2026,"$10,000.00","$11,500.00","($1,500.00)","($1,500.00)",$0.00,$0.00
`;

const webResult = parseSchwabRealizedGainLossCSV(
  RGL_SCHWAB_WEB,
  "Schwab_IRA_GainLoss_Realized_Details_20230627-154800_61697.csv",
  "test"
);
console.log({
  webStatus: webResult.batch.status,
  webImported: webResult.batch.totalTradesImported,
});

// Web export uses Closed Date (no Date Acquired) → sell-only rows
if (webResult.batch.totalTradesImported !== 2) {
  console.error("Expected 2 sell trades from Schwab web Realized Details sample");
  process.exit(1);
}

const USER_ROLLOVER_IRA = `"Realized Gain/Loss - Lot Details for Rollover_IRA as of Sun Jun 07  18:48:00 EDT 2026 from 10/01/2024 to 06/07/2026","","","","","","","","","","","","","","","","","","","","","","","",""
"Symbol","Name","Closed Date","Opened Date","Quantity","Proceeds Per Share","Cost Per Share","Proceeds","Cost Basis (CB)","Gain/Loss ($)","Gain/Loss (%)","Long Term Gain/Loss","Short Term Gain/Loss","Term","Unadjusted Cost Basis","Wash Sale?","Disallowed Loss","Transaction Closed Date","Transaction Cost Basis","Total Transaction Gain/Loss ($)","Total Transaction Gain/Loss (%)","LT Transaction Gain/Loss ($)","LT Transaction Gain/Loss (%)","ST Transaction Gain/Loss ($)","ST Transaction Gain/Loss (%)"
"AAOI","APPLIED OPTOELECTRON","06/05/2026","06/03/2026","150","$187.01","$187.98","$28,050.89","$28,197.02","-$146.13","-0.518246254391%","","-$146.13","Short Term","$28,197.02","No","","06/05/2026","","","","","","",""
"TSLA","TESLA INC","06/05/2026","06/04/2026","150","$415.64","$424.33","$62,346.33","$63,650.25","-$1,303.92","-2.048570115593%","","-$1,303.92","Short Term","$63,650.25","No","","06/05/2026","","","","","","",""
`;

const userResult = parseSchwabRealizedGainLossCSV(
  USER_ROLLOVER_IRA,
  "Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv",
  "test"
);
if (userResult.batch.totalTradesImported !== 4) {
  console.error("Expected 4 trades from user Rollover IRA sample");
  process.exit(1);
}
if (userResult.trades[0]?.accountName !== "Schwab Rollover IRA") {
  console.error("Expected account name Schwab Rollover IRA");
  process.exit(1);
}
