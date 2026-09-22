/**
 * Run with: npx tsx client/src/lib/chartLogoPrefs.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_COMPANY_LOGO_OPACITY,
  clampCompanyLogoOpacity,
  companyLogoOpacityFromPercent,
  companyLogoOpacityToPercent,
  getCompanyLogoOpacity,
  resetCompanyLogoOpacity,
  setCompanyLogoOpacity,
} from "./chartLogoPrefs";

const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
} as Storage;

assert.equal(DEFAULT_COMPANY_LOGO_OPACITY, 0.28);
assert.equal(clampCompanyLogoOpacity(undefined), 0.28);
assert.equal(clampCompanyLogoOpacity(-1), 0);
assert.equal(clampCompanyLogoOpacity(1.4), 1);
assert.equal(clampCompanyLogoOpacity("0.5"), 0.5);
assert.equal(companyLogoOpacityToPercent(0.28), 28);
assert.equal(companyLogoOpacityFromPercent(40), 0.4);
assert.equal(getCompanyLogoOpacity(), 0.28);

setCompanyLogoOpacity(0.55);
assert.equal(getCompanyLogoOpacity(), 0.55);
resetCompanyLogoOpacity();
assert.equal(getCompanyLogoOpacity(), 0.28);

console.log("chartLogoPrefs.test.ts: ok");
