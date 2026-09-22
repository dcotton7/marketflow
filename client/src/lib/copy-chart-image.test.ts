/**
 * Run with: npx tsx client/src/lib/copy-chart-image.test.ts
 */
import assert from "node:assert/strict";
import { buildChartCopyFilename, companyLogoSrc, COMPANY_LOGO_OPACITY, formatIntradayCopyLabel } from "./copy-chart-image";

assert.equal(formatIntradayCopyLabel("5min"), "Intraday 5m");
assert.equal(formatIntradayCopyLabel("15m"), "Intraday 15m");
assert.equal(formatIntradayCopyLabel("30min"), "Intraday 30m");

assert.equal(companyLogoSrc("aapl"), "/api/sentinel/company-logo/AAPL?v=3");
assert.equal(companyLogoSrc("!!!"), "");
assert.equal(COMPANY_LOGO_OPACITY > 0.12 && COMPANY_LOGO_OPACITY < 0.35, true);

const name = buildChartCopyFilename("aapl", "daily");
assert.match(name, /^AAPL_daily_\d{4}-\d{2}-\d{2}\.png$/);
assert.match(buildChartCopyFilename("aapl!!", "charts"), /^AAPL_charts_\d{4}-\d{2}-\d{2}\.png$/);

console.log("copy-chart-image.test.ts: ok");
