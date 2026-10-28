import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { COOKIE_SECONDS, EMBED_COOKIE, checkSigned, createAnimaEmbed, makeSigned, readCookie } from "./animaEmbed";

const TOKEN = "t".repeat(40);
const NOW = 1_800_000_000;

assert.ok(checkSigned(makeSigned("ticket", TOKEN, NOW + 300), "ticket", TOKEN, NOW, 600));
assert.ok(!checkSigned(makeSigned("ticket", TOKEN, NOW - 1), "ticket", TOKEN, NOW, 600), "expired");
assert.ok(!checkSigned(makeSigned("ticket", TOKEN, NOW + 3600), "ticket", TOKEN, NOW, 600), "too far ahead");
assert.ok(!checkSigned(makeSigned("cookie", TOKEN, NOW + 300), "ticket", TOKEN, NOW, 600), "a cookie is not a ticket");
assert.ok(!checkSigned(makeSigned("ticket", "u".repeat(40), NOW + 300), "ticket", TOKEN, NOW, 600), "other key");
assert.ok(!checkSigned(`${NOW + 300}.${"0".repeat(64)}`, "ticket", TOKEN, NOW, 600), "forged");
assert.ok(!checkSigned(undefined, "ticket", TOKEN, NOW, 600));
assert.equal(readCookie("a=1; mf_anima_embed=xyz; b=2", EMBED_COOKIE), "xyz");
assert.equal(readCookie("xmf_anima_embed=1", EMBED_COOKIE), "");

type Res = { status: number; body: string; headers: http.IncomingHttpHeaders };
async function withApp(token: string | undefined, fn: (call: (m: string, p: string, h?: Record<string, string>, b?: string) => Promise<Res>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(createAnimaEmbed({ token, userId: 2 }, () => NOW));
  app.use((req: any, res) => res.json({ path: req.url, uid: req.session?.userId ?? null }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn((method, path, headers = {}, sent) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end(sent);
    }));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const ticket = makeSigned("ticket", TOKEN, NOW + 300);
const cookie = `${EMBED_COOKIE}=${makeSigned("cookie", TOKEN, NOW + COOKIE_SECONDS)}`;

await withApp(TOKEN, async (call) => {
  const set = await call("GET", `/embed/charts?panel=mfcharts1&anima_ticket=${ticket}`);
  assert.equal(set.status, 302);
  assert.equal(set.headers.location, "/embed/charts?panel=mfcharts1", "ticket dropped from the address");
  const sc = String(set.headers["set-cookie"]);
  for (const part of ["HttpOnly", "Secure", "SameSite=None", "Partitioned", `Max-Age=${COOKIE_SECONDS}`]) assert.ok(sc.includes(part), part);
  assert.ok(checkSigned(sc.split(";")[0].split("=")[1], "cookie", TOKEN, NOW, COOKIE_SECONDS));

  const bad = await call("GET", `/embed/charts?anima_ticket=${NOW + 300}.${"0".repeat(64)}`);
  assert.equal(bad.status, 302);
  assert.equal(bad.headers["set-cookie"], undefined, "a forged ticket sets nothing");
  assert.equal((await call("GET", `/api/stocks/A/quote?anima_ticket=${ticket}`)).headers["set-cookie"], undefined, "tickets only on /embed");

  assert.equal(JSON.parse((await call("GET", "/api/stocks/AAPL/quote", { cookie })).body).uid, 2, "reads as the owner");
  assert.equal(JSON.parse((await call("POST", "/api/sentinel/evaluate", { cookie })).body).uid, null, "never writes");
  const json = { cookie, "content-type": "application/json" };
  assert.equal(JSON.parse((await call("POST", "/api/discord-stream/summary", json)).body).uid, 2, "the room summary button");
  assert.equal(JSON.parse((await call("POST", "/api/discord-stream/summary", { cookie })).body).uid, null, "JSON only");
  assert.equal(JSON.parse((await call("POST", "/api/discord-stream/clear", json)).body).uid, null, "only that one");
  assert.equal(JSON.parse((await call("POST", "/api/sentinel/watchlist/bulk-add", json)).body).uid, 2, "the paste in the full panel");
  assert.equal(JSON.parse((await call("POST", "/api/sentinel/watchlist/bulk-add", { cookie, "content-type": "text/plain" })).body).uid, null, "the paste is JSON only");
  for (const extra of [{ update: true }, { remove: ["NVDA"] }]) {
    const sent = JSON.stringify({ watchlistId: 3, items: [{ symbol: "NVDA" }], ...extra });
    assert.equal(JSON.parse((await call("POST", "/api/sentinel/watchlist/bulk-add", json, sent)).body).uid, null,
      `the panel's paste only adds: ${Object.keys(extra)[0]}`);
  }
  for (const p of ["/api/sentinel/watchlist", "/api/sentinel/watchlist/12/shares", "/api/sentinel/watchlist/bulk-add/x"]) {
    assert.equal(JSON.parse((await call("POST", p, json)).body).uid, null, `no other watchlist write: ${p}`);
  }
  assert.equal(JSON.parse((await call("PATCH", "/api/sentinel/watchlist/12", json)).body).uid, null, "no edits");
  assert.equal(JSON.parse((await call("DELETE", "/api/sentinel/watchlist/12", { cookie })).body).uid, null, "no removes");
  assert.equal(JSON.parse((await call("GET", "/api/x", { cookie: `${EMBED_COOKIE}=${NOW + 60}.${"a".repeat(64)}` })).body).uid, null, "forged cookie");
  assert.equal(JSON.parse((await call("GET", "/api/x", { cookie: `connect.sid=s; ${cookie}` })).body).uid, null, "a real login wins");
  assert.equal(JSON.parse((await call("GET", "/api/x")).body).uid, null);
});
await withApp(undefined, async (call) => {
  assert.equal((await call("GET", `/embed/charts?anima_ticket=${ticket}`)).status, 200, "off without the token");
  assert.equal(JSON.parse((await call("GET", "/api/x", { cookie })).body).uid, null);
});

console.log("anima embed ok");
