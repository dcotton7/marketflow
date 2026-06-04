# Theme Members MA columns

## What the columns show

Each MA column shows **percent distance from price to a daily moving average**:

```
((price − MA) / MA) × 100
```

- **Positive** = price above the MA (green)
- **Negative** = price below the MA (red)
- **White box** = within the MA bold threshold (admin setting, default 0.5%)

## Defaults

| Column | Default MA |
|--------|------------|
| MA1 | 20-day **SMA** |
| MA2 | 50-day SMA |

You can change MA1/MA2 via the column dropdowns; preferences persist in chart settings.

## Session-adjusted vs EOD

During market hours, MA **levels** use **session-adjusted** daily MAs:

1. Prior **completed** daily closes from `historical_bars`
2. Plus **today's developing bar** from the live snapshot (current price as close)

This is **not** a true 5-minute-bar MA. It is a daily MA that includes today's session in the current bar.

When session-adjusted data is unavailable, levels fall back to the **EOD** `ticker_ma` table (nightly refresh).

## Update cadence

| Data | Cadence |
|------|---------|
| Live **price** (numerator) | ~60s during market hours, ~5 min off-hours |
| MA **levels** (denominator) | Recomputed at least every **5 minutes** during session |
| **% vs MA** display | Updates every snapshot as price moves; levels step on MA refresh |

The Theme Members footer shows **MA levels session-adjusted as of HH:MM** when available.

## Display precision

Cells show **one decimal** (e.g. `+10.1%`). Hover for **two decimals** and the formula. Multiple tickers can appear identical at one decimal when values cluster.

## Missing values (`-`)

A dash means no MA could be computed—typically insufficient history, delisted symbol, or no bars in the database.
