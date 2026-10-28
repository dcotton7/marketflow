import assert from "node:assert/strict";

process.env.DISCORD_RELAY_TOKEN = "t".repeat(40);
const relay = await import("./discord-relay");

function call(body: unknown, token: string | undefined) {
  let code = 200;
  let json: unknown = null;
  const req = { body, get: (h: string) => (h.toLowerCase() === "x-relay-token" ? token : undefined) };
  const res = {
    status(c: number) { code = c; return res; },
    end() { return res; },
    json(j: unknown) { json = j; return res; },
  };
  relay.accept(req as never, res as never);
  return { code, json };
}

const msg = (seq: number, text = `m${seq}`) => ({ seq, id: `id${seq}`, author: "Nick Drendel", channel: "live-stream-chat",
  text, ts: Date.now(), tickers: [], side: null, action: null, time: "", capturedAt: new Date().toISOString() });

assert.equal(relay.hasData(), false);
assert.equal(call({ messages: [msg(1)] }, undefined).code, 404, "no token");
assert.equal(call({ messages: [msg(1)] }, "wrong").code, 404, "wrong token");
assert.equal(relay.hasData(), false, "a refused push stores nothing");

const T = "t".repeat(40);
assert.equal(call({ bootId: "a", status: { running: true }, oldestSeq: 1, messages: [msg(1), msg(2)] }, T).code, 200);
assert.equal(relay.hasData(), true);
assert.deepEqual(relay.getMessages().map((m) => m.seq), [1, 2]);
assert.equal(relay.getStatus().running, true);
assert.equal(relay.getStatus().relayed, true);

call({ bootId: "a", oldestSeq: 1, messages: [msg(2, "filled in"), msg(3)] }, T);
assert.deepEqual(relay.getMessages().map((m) => m.seq), [1, 2, 3], "a re-sent message replaces its copy");
assert.equal(relay.getMessages().find((m) => m.seq === 2)?.text, "filled in");
assert.deepEqual(relay.getMessages(2).map((m) => m.seq), [3]);

call({ bootId: "a", oldestSeq: 3, messages: [] }, T);
assert.deepEqual(relay.getMessages().map((m) => m.seq), [3], "messages the bridge dropped are dropped here too");

call({ bootId: "b", oldestSeq: 1, messages: [msg(1)] }, T);
assert.deepEqual(relay.getMessages().map((m) => m.seq), [1], "a restarted capture starts over");

console.log("discord-relay tests passed");
