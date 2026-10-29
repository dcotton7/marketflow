import assert from "node:assert/strict";
import * as React from "react";
import {
  detectAnimaEmbed,
  fetchTosStatus,
  isEmbeddedInAnima,
  resetAnimaEmbedCache,
  startTosStatusPolling,
  tosCalibrate,
  tosNavigate,
} from "@/lib/tos-bridge-client";
import { TosSyncProvider } from "@/context/TosSyncContext";

const MF = "https://marketflow.example";

// detectAnimaEmbed: each way MarketFlow can be loaded.
assert.equal(detectAnimaEmbed({ framed: false, selfOrigin: MF, referrer: "https://anima-u2fy.onrender.com/" }), false, "top-level");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, ancestorOrigins: ["https://anima-u2fy.onrender.com"] }), true, "Anima online");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: "http://127.0.0.1:5000", ancestorOrigins: ["http://127.0.0.1:8770"] }), true, "Anima local");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: "http://localhost:5000", ancestorOrigins: ["http://localhost:8771"] }), true, "Anima on another local port");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, referrer: "http://localhost:8770/lab" }), true, "referrer (no ancestorOrigins)");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, search: "?host=anima" }), true, "explicit host flag");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, search: "?embed=anima" }), true, "explicit embed flag");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, ancestorOrigins: ["https://evil.example"] }), false, "embedded elsewhere");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF, referrer: "https://evil.example/x" }), false, "referrer elsewhere");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: MF }), false, "framed, no clue");
assert.equal(detectAnimaEmbed({ framed: true, selfOrigin: "http://localhost:5000", ancestorOrigins: ["http://localhost:5000"] }), false, "MarketFlow framing itself");
assert.equal(
  detectAnimaEmbed({ framed: true, selfOrigin: MF, ancestorOrigins: ["https://evil.example"], referrer: "https://anima-u2fy.onrender.com/" }),
  false,
  "ancestorOrigins wins over a referrer",
);

// A fake browser: window, document, fetch and timers that record what they were asked to do.
const g = globalThis as any;
// tsx compiles the provider's JSX to React.createElement (tsconfig keeps jsx: preserve for Vite).
g.React = React;
const fetched: string[] = [];
let intervals = 0;
g.fetch = async (url: string) => {
  fetched.push(String(url));
  return new Response(JSON.stringify({ available: true, calibrated: true }), { status: 200 });
};
const realSetInterval = g.setInterval;
g.setInterval = (...args: unknown[]) => {
  intervals++;
  return realSetInterval(() => {}, 1 << 30);
};

function loadIn(opts: { framed: boolean; ancestor?: string }) {
  const win: any = {
    location: {
      origin: MF,
      search: "",
      ancestorOrigins: opts.ancestor ? [opts.ancestor] : undefined,
    },
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
  };
  win.self = win;
  win.top = opts.framed ? {} : win;
  g.window = win;
  g.document = { referrer: "" };
  resetAnimaEmbedCache();
  fetched.length = 0;
  intervals = 0;
}

async function run() {
  // Inside Anima: no status polling, no /status, no /navigate, no calibrate.
  loadIn({ framed: true, ancestor: "https://anima-u2fy.onrender.com" });
  assert.equal(isEmbeddedInAnima(), true);
  let refreshes = 0;
  const stop = startTosStatusPolling(() => { refreshes++; });
  stop();
  assert.equal(refreshes, 0, "no refresh in Anima");
  assert.equal(intervals, 0, "no interval in Anima");
  const s = await fetchTosStatus();
  assert.equal(s.available, false);
  await tosNavigate("AAPL");
  await assert.rejects(tosCalibrate(), /driven by Anima/);
  assert.deepEqual(fetched, [], "nothing fetched in Anima");

  // The provider hands out the static Anima state and mounts no polling provider.
  const el = TosSyncProvider({ children: null }) as any;
  assert.equal(el.props.value.animaHosted, true);
  assert.equal(el.props.value.tosSyncEnabled, false);
  await el.props.value.tosNavigate("MSFT");
  await el.props.value.refreshStatus();
  assert.deepEqual(fetched, [], "provider never fetched in Anima");
  assert.equal(intervals, 0);

  // Framed by another site: unchanged behavior (polls and calls the helper).
  loadIn({ framed: true, ancestor: "https://evil.example" });
  assert.equal(isEmbeddedInAnima(), false);
  const stop2 = startTosStatusPolling(() => { refreshes++; });
  stop2();
  assert.equal(refreshes, 1, "refreshes at once when not in Anima");
  assert.equal(intervals, 1, "polls when not in Anima");

  // Top-level MarketFlow: polls, and status reaches the helper.
  loadIn({ framed: false });
  assert.equal(isEmbeddedInAnima(), false);
  const stop3 = startTosStatusPolling(() => {});
  stop3();
  assert.equal(intervals, 1);
  await fetchTosStatus();
  assert.ok(fetched.some((u) => u.startsWith("http://127.0.0.1:7737/status")), "standalone asks the helper");
  const el3 = TosSyncProvider({ children: null }) as any;
  assert.notEqual(el3.props.value?.animaHosted, true, "standalone gets the live provider");

  console.log("tos-bridge-client tests passed");
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
