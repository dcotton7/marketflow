# Actionable detail properties

Theme Detail **Actionable** panel breaks readiness into five segments. Each maps to a 0–100 score (segment bars) and contributes to **Watch** vs **Tradeable** heuristics.

## Rotation

**What it measures:** Is the theme moving up or down the leaderboard?

- **Delta rank:** Change in theme rank vs prior snapshot (negative = fading)
- **Acceleration:** Change in RS vs prior snapshot

**Approximate formula:** `50 + (deltaRank × 10) + (acceleration × 4)`, clamped 0–100

## Participation

**What it measures:** How many members are participating in today's move?

- **Breadth** = % of theme members with **positive** `pctChange` today
- This is **not** core-member count or "names with volume"

**Formula:** `score = breadthPct`

## Leadership

**What it measures:** Is the theme beating the market on average?

- Uses **median** member RS vs SPY (reduces single-name skew)

**Approximate formula:** `50 + (median RS vs SPY × 10)`, clamped 0–100

## Confirmation

**What it measures:** Is volume and accumulation/distribution supporting the move?

- **Volume expansion (`volExp`):** Median member ratio of today's volume vs 20-day average
- **A/D bias:** Accumulation vs distribution counts from member Acc/Dist stats when available

**Approximate formula:** `40 + (volExp − 1) × 22 + A/D bias`

Theme-level `volExp` is the **median** of member volume expansion values.

## Durability

**What it measures:** Is strength broad or concentrated in a few names?

- **Top 3 contribution:** Share of the theme's positive return from the top 3 movers

**Formula:** `100 − (top3Contribution × 100)`

Higher = more durable / less narrow leadership.

## Watch vs Tradeable

Heuristic gates combine segment scores, ThemeScore, breadth, and penalty factors. A theme can rank well but show **Watch** if confirmation or durability is weak.

## Known limits

- Historical time slices use stored snapshots; live session-adjusted MAs apply to **TODAY** only.
- Delisted or thin-history symbols reduce breadth and MA coverage.
