import { detectSchwabCsvType, parseSchwabRealizedGainLossLots } from "@shared/schwab-csv";
import { parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";

const REAL = `"Symbol","Name","Closed Date","Opened Date","Quantity","Proceeds Per Share","Cost Per Share","Proceeds","Cost Basis (CB)","Gain/Loss ($)","Gain/Loss (%)","Long Term Gain/Loss","Short Term Gain/Loss","Term","Unadjusted Cost Basis","Wash Sale?","Disallowed Loss","Transaction Closed Date","Transaction Cost Basis","Total Transaction Gain/Loss ($)","Total Transaction Gain/Loss (%)","LT Transaction Gain/Loss ($)","LT Transaction Gain/Loss (%)","ST Transaction Gain/Loss ($)","ST Transaction Gain/Loss (%)"
"TSLA","TESLA INC","06/06/2025","06/06/2025","500","$275.58","$279.47","$137,787.67","$139,733.65","-$1,945.98","-1.412303437601%","","-$1,945.98","Short Term","$139,733.65","No","","06/05/2025","","","","","","",""
`;

const DETAILS_VARIANTS = [
  `Schwab IRA GainLoss Realized Details
Symbol,Description,Quantity,Closed Date,Proceeds,Cost Basis (CB),Gain/Loss ($)
AAPL,AAPL,100,02/01/2026,22050,15000,7050`,
  `Symbol\tName\tClosed Date\tOpened Date\tQuantity\tProceeds\tCost Basis (CB)\tGain/Loss ($)
TSLA\tTESLA\t06/06/2025\t06/06/2025\t500\t137787.67\t139733.65\t-1945.98`,
  `Ticker,Shares,Sale Date,Purchase Date,Cost,Proceeds,Gain/Loss
MSFT,50,03/15/2026,01/10/2024,8000,10000,2000`,
  `"Symbol","Name","Closed Date","Opened Date","Quantity","Total Proceeds","Cost Basis (CB)","Realized $ P&L"
"AAPL","APPLE","02/01/2026","01/15/2024","100","$22,050.00","$15,000.00","$7,050.00"`,
];

console.log("REAL github export:");
console.log({
  type: detectSchwabCsvType(REAL),
  lots: parseSchwabRealizedGainLossLots(REAL).length,
  trades: parseSchwabRealizedGainLossCSV(REAL, "Schwab_IRA_Realized_GainLoss_Details_test.csv", "test").batch
    .totalTradesImported,
});

for (let i = 0; i < DETAILS_VARIANTS.length; i++) {
  const sample = DETAILS_VARIANTS[i]!;
  console.log(`Variant ${i + 1}:`, {
    type: detectSchwabCsvType(sample),
    lots: parseSchwabRealizedGainLossLots(sample).length,
    trades: parseSchwabRealizedGainLossCSV(sample, "Schwab_IRA_Realized_GainLoss_Details_test.csv", "test").batch
      .totalTradesImported,
  });
}
