# Theme rank and ThemeScore

## Leaderboard rank

Theme **rank** is the sort order of themes by **ThemeScore** (highest first). **Delta rank** compares today's rank to the prior comparison snapshot (typically prior 15-minute theme snapshot or configured baseline).

## ThemeScore v2 (0–100)

ThemeScore is built from **cross-theme percentile ranks**, not fixed point buckets:

| Component | Weight | Source |
|-----------|--------|--------|
| Median member return | 40% | Median `pctChange` across theme members |
| Breadth (trend) | 20% | % members above 50d and 200d MAs |
| RS vs SPY | 20% | Median member RS vs benchmark |
| RS acceleration | 20% | Change in RS vs prior snapshot |
| Narrow leadership penalty | multiplier | Reduces score when top 3 names dominate positive returns |

Percentile rank maps each raw metric to 0–100 relative to all themes, then weights are applied.

## Narrow leadership penalty

When a small subset of names drives most of the theme's positive move, the theme gets a **penalty factor** (< 1.0) applied to the final score. This surfaces "one-name wonders" vs broad participation.

## Actionable Rotation segment

The **Rotation** bar in Theme Detail uses **delta rank** and **acceleration**, not the full ThemeScore formula. See [actionable-details-properties.md](./actionable-details-properties.md).
