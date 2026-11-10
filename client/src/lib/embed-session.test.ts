// 10 Nov: the Lab's scanner embed had been open 17 h; its 12 h cookie was gone, /api/scanner/status answered
// 401 { error: "Login required" }, the page stored that as its status and crashed on status.sessionMode.replace.
import { isScannerStatus } from "@shared/scanner-types";
import {
  _resetEmbedSession,
  embedSessionExpired,
  installEmbedSessionWatch,
  isSessionLoss,
  markEmbedSignedIn,
} from "@/lib/embed-session";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ORIGIN = "https://marketflow-hrxh.onrender.com";

function testSessionLoss() {
  assert(isSessionLoss("/api/scanner/status", 401, ORIGIN), "our api 401");
  assert(isSessionLoss(`${ORIGIN}/api/scanner/history?limit=100`, 401, ORIGIN), "absolute same-origin");
  assert(!isSessionLoss("/api/scanner/status", 500, ORIGIN), "500 is not a lost session");
  assert(!isSessionLoss("/api/auth/me", 401, ORIGIN), "the sign-in check is the route's business");
  assert(!isSessionLoss("https://other.example/api/x", 401, ORIGIN), "another site");
  assert(!isSessionLoss("/embed/scanner", 401, ORIGIN), "not /api");
}

function testStatusGuard() {
  assert(!isScannerStatus({ error: "Login required" }), "error body is not a status");
  assert(!isScannerStatus(null), "null");
  assert(
    isScannerStatus({ mode: "on", universeSize: 1, activePipelines: 1, lastSignalAt: null, discoveriesToday: 0, sessionMode: "regular" }),
    "real status"
  );
}

async function testWatch() {
  const posted: unknown[] = [];
  const parent = { postMessage: (m: unknown, o: string) => posted.push([m, o]) };
  const statuses: Record<string, number> = { "/api/scanner/status": 401, "/api/scanner/history": 200 };
  const win = {
    location: { pathname: "/embed/scanner", origin: ORIGIN, ancestorOrigins: ["https://anima-u2fy.onrender.com"] },
    parent,
    fetch: async (input: string) => ({ status: statuses[input] ?? 200 }) as Response,
  } as unknown as Window & typeof globalThis;
  (globalThis as { window?: unknown }).window = win;
  _resetEmbedSession();
  installEmbedSessionWatch(win);

  await win.fetch("/api/scanner/status");
  assert(!embedSessionExpired() && posted.length === 0, "a 401 before sign-in is left to the sign-in route");

  markEmbedSignedIn();
  await win.fetch("/api/scanner/history");
  assert(!embedSessionExpired(), "a 200 changes nothing");
  await win.fetch("/api/scanner/status");
  await win.fetch("/api/scanner/status");
  assert(embedSessionExpired(), "a 401 after sign-in is a lost session");
  assert(posted.length === 1, `the host is told once, got ${posted.length}`);
  const [msg, origin] = posted[0] as [Record<string, string>, string];
  assert(origin === "https://anima-u2fy.onrender.com", "posted to the host only");
  assert(msg.source === "marketflow" && msg.type === "auth-failed" && msg.reason === "expired", JSON.stringify(msg));
  assert(msg.page === "/embed/scanner", "names the page");
}

testSessionLoss();
testStatusGuard();
testWatch().then(
  () => console.log("embed-session tests passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
