/**
 * ToS link: navigate passes where the calibrated point sits inside its ToS window, so a moved window still gets the
 * click; tos-win.ps1 uses per-monitor-v2 DPI so the point is in physical pixels on every monitor.
 * Run with: npx tsx server/bridge/tos-bridge.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { navigateArgs } from "./tos-bridge";

assert.deepEqual(navigateArgs({ x: 5177, y: 224, calibratedAt: "" }, "NVDA"),
  ["-Action", "navigate", "-Symbol", "NVDA", "-X", "5177", "-Y", "224"], "an older calibration clicks its point as before");
assert.deepEqual(
  navigateArgs({ x: 5177, y: 224, dx: 1820, dy: 224, w: 4323, h: 2160, title: "Main@thinkorswim [build 1994]", calibratedAt: "" }, "NVDA"),
  ["-Action", "navigate", "-Symbol", "NVDA", "-X", "5177", "-Y", "224", "-DX", "1820", "-DY", "224", "-W", "4323", "-H", "2160",
    "-Title", "Main@thinkorswim [build 1994]"]);

const win = readFileSync(resolve(process.cwd(), "server/bridge/tos-win.ps1"), "utf8");
assert.ok(win.includes("SetProcessDpiAwarenessContext(new IntPtr(-4))"), "per-monitor v2 DPI");
assert.ok(/\$dpiMode = \[TosWin\]::UsePhysicalPixels\(\)/.test(win), "set before any cursor or window read");
assert.ok(win.indexOf("UsePhysicalPixels()") < win.indexOf('if ($Action -eq "calibrate")'));
assert.ok(/dx = \$px - \$r\.Left/.test(win) && /dy = \$py - \$r\.Top/.test(win), "calibrate records the offset in its window");
assert.ok(win.includes("$pick = Select-TosTarget $tosWindows"), "navigate finds the calibrated window first");

const agent = readFileSync(resolve(process.cwd(), "server/bridge/tos-agent.ps1"), "utf8");
assert.ok(agent.includes('$cal.dx = [int]$result.dx'), "the PC agent saves the offset");
assert.ok(agent.includes('"-DX", ([string][int]$cal.dx)'), "and passes it to navigate");
console.log("✅ tos bridge tests passed");
