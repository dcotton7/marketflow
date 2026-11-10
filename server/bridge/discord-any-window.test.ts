/**
 * Discord capture from any window (10 Nov: the main Discord sat on #trading-floor for 14 hours and nothing was caught).
 * Fixed cases on mocked window lists: the watcher's own title parsing (PowerShell, no real windows read), health, and
 * one post shown by two windows kept once.
 * Run with: npx tsx server/bridge/discord-any-window.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discordHealth } from "./discord-health";

process.env.NODE_ENV = "production"; // never start or resume a real watcher from a test
const bridge = await import("./discord-bridge");

// --- 1. The watcher classifies a window list (DISCORD_WATCH_CLASSIFY test hook: reads the list from a file) ------------
if (process.platform === "win32") {
  const rows = [
    { process: "Discord", title: "#📈︱trading-floor | Market Pulse - Discord", minimized: false },
    { process: "DiscordPTB", title: "#💬︱live-stream-chat | Market Pulse - Discord", minimized: false },
    { process: "chrome", title: "(2) #live-stream-chat | Market Pulse - Discord - Google Chrome", minimized: false },
    { process: "msedge", title: "#🟢live-long-ideas | Market Pulse - Discord and 3 more pages - Work - Microsoft​ Edge", minimized: true },
    { process: "firefox", title: "• #live-short-ideas | Market Pulse - Discord — Mozilla Firefox", minimized: false },
    { process: "chrome", title: "Discord pricing - Google Search - Google Chrome", minimized: false },
    { process: "chrome", title: "Inbox (3) - Gmail - Google Chrome", minimized: false },
    { process: "Code", title: "#live-stream-chat | Market Pulse - Discord", minimized: false },
    { process: "DiscordCanary", title: "Friends - Discord", minimized: false },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-"));
  const file = path.join(dir, "windows.json");
  fs.writeFileSync(file, JSON.stringify(rows), "utf8");
  const out = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(import.meta.dirname, "discord-watch.ps1")], { env: { ...process.env, DISCORD_WATCH_CLASSIFY: file }, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  const got = JSON.parse(out.trim().split(/\r?\n/).pop()!) as { kind: string; channel: string; server: string; watched: boolean; minimized: boolean }[];
  assert.deepEqual(got.map((g) => [g.kind, g.channel, g.server, g.watched, g.minimized]), [
    ["desktop", "trading-floor", "Market Pulse", false, false],
    ["ptb", "live-stream-chat", "Market Pulse", true, false],
    ["browser", "live-stream-chat", "Market Pulse", true, false],
    ["browser", "live-long-ideas", "Market Pulse", true, true],
    ["browser", "live-short-ideas", "Market Pulse", true, false],
    ["canary", "", "", false, false],
  ], "Discord apps and Discord browser tabs only; a Google search for 'Discord' and other apps are not windows to read");
} else {
  console.log("(skipping the PowerShell window cases: not Windows)");
}

// --- 2. Health on mocked window lists ------------------------------------------------------------------------------
const now = Date.parse("2026-11-10T15:00:00Z"); // Tue 10:00 ET
const busy = Array.from({ length: 30 }, (_, i) => ({ ts: now - i * 20_000 }));
const silent = [{ ts: now - 40 * 60_000 }];
const watcher = (windows: Record<string, unknown>[], main: Record<string, unknown> = {}) => ({
  running: true, relayStale: false, watcher: {
    window: true, running: true, minimized: false, watching: "live-stream-chat",
    channels: ["live-stream-chat", "live-long-ideas", "live-short-ideas", "nick-drendel"],
    channelName: "📈︱trading-floor", openChannel: "trading-floor", server: "Market Pulse", windows, ...main,
  },
});
const floor = { kind: "desktop", channel: "trading-floor", server: "Market Pulse", minimized: false, watched: false, capturing: false };
const ptbChat = { kind: "ptb", channel: "live-stream-chat", server: "Market Pulse", minimized: false, watched: true, capturing: true };

const parked = discordHealth({ source: "relay", status: watcher([floor, ptbChat], { channelName: "💬︱live-stream-chat", openChannel: "live-stream-chat" }), messages: busy, now });
assert.deepEqual(parked.problems, [], "main on trading-floor + PTB on live-stream-chat: capturing, no problem");
assert.equal(parked.ok, true);

const parkedQuiet = discordHealth({ source: "relay", status: watcher([floor, ptbChat]), messages: silent, now });
assert.deepEqual(parkedQuiet.problems, ["no_new_messages_20m"], "a parked window and a quiet room is only a quiet room");

const onlyFloor = discordHealth({ source: "relay", status: watcher([floor]), messages: silent, now });
assert.deepEqual(onlyFloor.problems, ["wrong_channel_open"]);
assert.deepEqual(onlyFloor.messages, [
  "No Discord window is showing #live-stream-chat (Discord is on #trading-floor, Market Pulse). " +
  "Open #live-stream-chat in a second Discord window (Discord PTB, or discord.com in its own browser window) and leave it behind your other windows",
]);

const browserChat = { kind: "browser", channel: "live-stream-chat", server: "Market Pulse", minimized: false, watched: true, capturing: true };
assert.deepEqual(discordHealth({ source: "local", status: watcher([floor, browserChat]), messages: busy, now }).problems, [], "a browser tab on the room counts");
assert.deepEqual(discordHealth({ source: "local", status: watcher([floor, { ...ptbChat, minimized: true }]), messages: silent, now }).problems,
  ["wrong_channel_open"], "a minimized parked window doesn't render, so it doesn't count");
assert.deepEqual(discordHealth({ source: "local", status: watcher([{ ...floor, minimized: true }], { minimized: true }), messages: silent, now }).problems,
  ["discord_minimized"], "every Discord window minimized");
assert.deepEqual(discordHealth({ source: "local", status: watcher([], { window: false, channelName: "", openChannel: "" }), messages: silent, now }).problems,
  ["discord_minimized"], "Discord closed to the tray: a process, no window");

// --- 3. The same post from two windows is kept once ------------------------------------------------------------------
const line = (window: string) => JSON.stringify({
  type: "msg", id: "1437500000000000001", channelId: "1100000000000000001", channel: "live-stream-chat", server: "Market Pulse",
  author: "Nick Drendel", time: "10:01 AM", text: "TSLA long over 431.20", capturedAt: new Date(now).toISOString(), window,
});
bridge.clear();
bridge.handleLine(line("desktop"));
bridge.handleLine(line("ptb"));
bridge.handleLine(line("browser"));
assert.equal(bridge.getMessages().length, 1, "one post, three windows: counted once");
bridge.clear();

console.log("✅ discord any-window tests passed");
