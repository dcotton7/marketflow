import assert from "node:assert/strict";
import { marketDateOrNull } from "./dates";

assert.equal(marketDateOrNull("2026-09-28"), "2026-09-28");
assert.equal(marketDateOrNull(""), null);
assert.equal(marketDateOrNull("0028-09-15"), null);
assert.equal(marketDateOrNull("2026-02-31"), null);
assert.equal(marketDateOrNull("99-09-15"), null);
console.log("market-leaders dates.test.ts ok");
