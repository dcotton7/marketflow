/**
 * Run with: npx tsx server/company-logo.test.ts
 */
import assert from "node:assert/strict";
import { sanitizeLogoSymbol } from "./company-logo";

assert.equal(sanitizeLogoSymbol("aapl"), "AAPL");
assert.equal(sanitizeLogoSymbol("BRK.B"), "BRK.B");
assert.equal(sanitizeLogoSymbol("not a ticker!!!"), null);
assert.equal(sanitizeLogoSymbol(""), null);

console.log("company-logo.test.ts: ok");
