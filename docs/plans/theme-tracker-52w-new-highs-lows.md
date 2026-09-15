# Theme Tracker — 52-Week New Highs / New Lows

**Status:** Planned — not started  
**Priority fit:** Supports Market Flow / theme tracker quality (adjacent to Alerts & Workspace priorities)  
**Decision (Don, 2026-07-15):** Defer implementation. Save plan only.

## Why

Theme score today answers “is the theme participating?” via:

- day green % / median %
- % above 50d / 200d SMA
- RS, acceleration, vol expansion

It does **not** answer “are members expanding into new high ground, or just bouncing?”

A theme can score well with **zero** 52w new highs (relief rally). A quieter theme with several NH prints can be early leadership.

True all-time highs (ATH/ATL) are rarer and noisier for midcaps/IPOs. Prefer **52-week NH/NL** as the primary metric; optional true ATH as a secondary later.

## Existing gap in code

- `ThemeMetrics` (`server/market-condition/engine/theme-score.ts`) has no `newHighs52w` / `newLows52w`.
- UI already has a `NEW_HIGHS` reason-code label in `ThemeDetailPanel.tsx`, but `generateReasonCodes()` never emits it.
- Per-ticker `week52High` / `week52Low` exist in fundamentals cache — not rolled into theme breadth.

## Recommended v1 (low overhead)

### Per theme (members in cluster)

| Field | Meaning |
|-------|---------|
| `newHighs52w` | Count of members at or within X% of 52w high **or** making a new high on the day |
| `newLows52w` | Same for 52w low |
| `pctNear52wHigh` | Optional % of members |

Suggested threshold: within **1–2%** of 52w high/low counts as “near,” or use day’s high/low vs prior 52w print.

### Market strip (optional, same pass)

- Universe NH − NL (classic breadth cue)

### Reason codes

Wire `NEW_HIGHS` / `NEW_LOWS` into `generateReasonCodes` when counts (or %) cross a threshold (e.g. ≥3 members or ≥20% of theme).

## Data source options

1. **Reuse cached `week52High`/`week52Low` on ticker rows** + live snapshot price — cheapest if fundamentals cache coverage is decent for universe.
2. **Compute from daily bars** already loaded for MAs — more accurate, higher memory/CPU; keep behind memory gate if used.
3. Prefer (1) for v1; fall back to (2) when 52w cache null.

## UI surfaces

- Theme tracker / theme box: show `NH / NL` (e.g. `3 / 0`) next to breadth
- Theme detail: chip when `NEW_HIGHS` / `NEW_LOWS` fires
- Optional MarketFlow regime/command strip: market NH−NL

## Non-goals (for v1)

- True lifetime ATH/ATL as primary metric
- Weighting NH/NL into ThemeScore formula (display + reason codes first; scoring weight later if useful)

## Implementation sketch (when approved)

1. Extend `TickerMetrics` with `near52wHigh` / `near52wLow` (or distance %).
2. Aggregate into `ThemeMetrics`: `newHighs52w`, `newLows52w`.
3. Emit reason codes; surface in client types (`useMarketCondition`) and theme tracker UI.
4. Memory: no new polling loop — compute during existing snapshot refresh if bars/cache already available.

## Acceptance

- Selected theme shows NH/NL counts that move with session.
- Theme with several names at highs shows `NEW_HIGHS` chip; broken themes show `NEW_LOWS`.
- No extra Render heap pressure from a new background poller.
