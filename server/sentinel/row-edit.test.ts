import assert from "node:assert/strict";
import { normalizeRowEdit } from "./row-edit";
import { watchlistSchema } from "./watchlist-schema";

const parse = (body: unknown) => watchlistSchema.partial().parse(normalizeRowEdit(body));

// The Side toggle's write is kept (zod used to drop it, so the row stayed long).
assert.deepEqual(parse({ direction: "short" }), { direction: "short" });
assert.deepEqual(parse({ direction: "Long" }), { direction: "long" });
assert.throws(() => parse({ direction: "sideways" }));

// "-100" in the Shares cell is 100 shares short; a positive count leaves the side alone.
assert.deepEqual(parse({ shares: -100 }), { shares: 100, direction: "short" });
assert.deepEqual(parse({ shares: -40, direction: "long" }), { shares: 40, direction: "long" }, "a side sent with it wins");
assert.deepEqual(parse({ shares: 25 }), { shares: 25 });
assert.deepEqual(parse({ shares: null }), { shares: null });

// A short's stop sits above its entry; the row takes it as it is.
assert.deepEqual(parse({ targetEntry: 250, stopPlan: 262.5 }), { targetEntry: 250, stopPlan: 262.5 });

console.log("row-edit tests passed");
