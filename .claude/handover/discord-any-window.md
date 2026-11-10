# Discord capture from any window (branch `anima/discord-any-window`, 10 Nov)

Don, 10 Nov: his Discord sat on #trading-floor for 14 hours and nothing was captured. "Fix this BS".

## What changed
- `server/bridge/discord-watch.ps1` reads **every** top-level window that shows Discord, not only the main Discord.exe
  window: the Discord app, Discord PTB, Discord Canary, the app's pop-out windows, and a Chrome / Edge / Firefox /
  Brave / Opera / Vivaldi window whose active tab is discord.com. Each window showing a watched channel (not minimized)
  is read through UI Automation. One seen-set for all windows: a post shown in two windows is emitted once (its key
  `chat-messages-<channel>-<message>` is the same everywhere). Each `msg` now carries `window` (desktop/ptb/canary/browser).
  Window listing uses EnumWindows / IsWindowVisible / IsIconic / GetWindowText only: no focus, no clicks, no messages sent.
- The heartbeat keeps its old single-window fields (the capturing window, else the main app) and adds
  `windows: [{kind, channel, server, minimized, watched, capturing}]`.
- `discord-health.ts`: with `windows` present, `wrong_channel_open` fires only when **no** non-minimized window shows a
  watched channel; all Discord windows minimized gives `discord_minimized`. Older watchers fall back to the old rules.
  New text: "No Discord window is showing #live-stream-chat (Discord is on #trading-floor, Market Pulse). Open
  #live-stream-chat in a second Discord window (Discord PTB, or discord.com in its own browser window) and leave it
  behind your other windows".
- Toast (notification) source unchanged. Two Discord apps both toast; the existing twin matching keeps one.
- `discord-bridge.ts`: `handleLine` exported for the test; `WatcherStatus.windows` typed.

## Tests
- `npx tsx server/bridge/discord-any-window.test.ts`: the watcher's own title parser on a mocked window list
  (`DISCORD_WATCH_CLASSIFY=<json file>` test hook, reads no real windows): app on trading-floor, PTB on live-stream-chat,
  Chrome "(2) #live-stream-chat | Market Pulse - Discord - Google Chrome", Edge "... and 3 more pages - Work - Microsoft
  Edge", Firefox, a Google search for "Discord" (ignored), VS Code (ignored), Canary on Friends. Health: main on
  trading-floor + PTB on live-stream-chat = no problem; only trading-floor = `wrong_channel_open` with the new text;
  browser tab counts; minimized parked window doesn't count. Same post from three windows = 1 message.
- discord-health (one assertion updated for the new text), twin and relay tests pass. tsc filtered to touched files: clean.
- Smoke on Don's PC (read-only): watcher saw the one Discord window (trading-floor), no capture, heartbeat lists it.
  With `-Also trading-floor` it captured 30 messages through the new per-window loop, `window: desktop`.

## Covered windows: what's known, what isn't
- On this PC Discord sits uncovered on the second monitor (DISPLAY1), so a covered window could not be tested without
  putting a window over it, which the brief ruled out. A new post did reach the UIA tree while Discord was in the
  background (not foreground), as expected for an uncovered window.
- Minimized: Chromium stops rendering, nothing updates. Never minimize the parked window.
- Discord PTB/Canary are Electron apps like Discord itself. Electron leaves Chromium's native occlusion tracking off
  by default, so a covered (not minimized) Electron window keeps rendering: PTB parked behind other windows is the
  recommended setup. Not yet confirmed on Don's PC.
- Chrome / Edge do track occlusion: a window that is fully covered can be treated as hidden and stop updating. A
  browser window is the fallback; leave a sliver of it visible (or put it on a spot nothing covers).
- How to confirm after setup: `GET /api/discord-stream/status` (or the heartbeat) shows `windows[].capturing: true`
  for the PTB window, and new posts keep arriving with `window: "ptb"` while it is covered. If they stop when covered,
  move PTB to a corner nothing covers fully.

## Don's one-time setup
1. Install Discord PTB (discord.com/download, "Public Test Build") and sign in with the same account.
2. In PTB open Market Pulse, #live-stream-chat, scrolled to the newest message.
3. Leave the PTB window open behind your other windows (never minimized). Use your main Discord for anything.

## Left / gotchas
- Not merged; the admin merges on Don's OK. Watcher runs on the PC, so the PC copy needs a restart of the bridge.
- A browser counts only while its **active tab** is Discord (Chrome exposes only that tab).
- PowerShell 5.1: `ConvertFrom-Json` hands an array on as one object; the test hook unrolls it with ForEach-Object.
