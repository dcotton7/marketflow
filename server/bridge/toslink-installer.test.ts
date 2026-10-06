/**
 * Run with: npx tsx server/bridge/toslink-installer.test.ts
 */
import assert from "node:assert/strict";
import {
  buildTosLinkCmd,
  sanitizeTosHelperOrigin,
  tosHelperOriginFromRequest,
} from "./toslink-installer";

assert.equal(sanitizeTosHelperOrigin("https://app.example.com/"), "https://app.example.com");
assert.equal(sanitizeTosHelperOrigin("http://localhost:5000"), "http://localhost:5000");
assert.equal(sanitizeTosHelperOrigin('https://evil.com/"&calc'), null);
assert.equal(sanitizeTosHelperOrigin("file://C:/windows"), null);
assert.equal(sanitizeTosHelperOrigin("https://app.example.com/path"), null);

assert.equal(
  tosHelperOriginFromRequest({
    protocol: "http",
    headers: { host: "localhost:5000" },
  }),
  "http://localhost:5000",
);
assert.equal(
  tosHelperOriginFromRequest({
    protocol: "http",
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "live.example.com",
      host: "localhost:5000",
    },
  }),
  "https://live.example.com",
);

const cmd = buildTosLinkCmd("https://app.example.com/");
assert.match(cmd, /set "ORIGIN=https:\/\/app.example.com"/);
assert.match(cmd, /install-toslink\.ps1/);
assert.doesNotMatch(cmd, /&|\|/);

assert.throws(() => buildTosLinkCmd("not-a-url"));

console.log("toslink-installer.test.ts: ok");
