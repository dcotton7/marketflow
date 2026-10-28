import assert from "node:assert/strict";
import { fetchAlpacaSnapshotQuotes } from "./alpaca";

const urls: string[] = [];
globalThis.fetch = (async (url: string) => {
  urls.push(url);
  const symbols = decodeURIComponent(new URL(url).searchParams.get("symbols") || "").split(",");
  const body: Record<string, unknown> = {};
  for (const s of symbols) {
    if (s === "NOPREV") body[s] = { latestTrade: { p: 5, t: "2026-10-28T19:00:00Z" } };
    else if (s !== "GONE") {
      body[s] = {
        latestTrade: { p: 110, t: "2026-10-28T19:00:00Z" },
        dailyBar: { o: 101, h: 111, l: 99, c: 109, v: 5000, vw: 105 },
        prevDailyBar: { c: 100 },
      };
    }
  }
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const many = Array.from({ length: 150 }, (_, i) => `T${i}`);
const out = await fetchAlpacaSnapshotQuotes([...many, "t0", "NOPREV", "GONE"]);

assert.equal(urls.length, 2, "153 symbols (one duplicate) go out as two requests of up to 100");
assert.equal(out.size, 150, "no previous close or no snapshot means no quote");
assert.deepEqual(out.get("T7"), {
  price: 110, prevClose: 100, open: 101, high: 111, low: 99, volume: 5000, vwap: 105, timestamp: "2026-10-28T19:00:00Z",
});
assert.equal((await fetchAlpacaSnapshotQuotes([])).size, 0);
assert.equal(urls.length, 2, "nothing asked, nothing fetched");
console.log("alpaca snapshot quotes: ok");
