# MarketFlow snapshot cadence

MarketFlow uses several timers. They are **not** interchangeable.

## MC quote snapshot poll

| Session | Interval |
|---------|----------|
| Market hours (ET) | **~60 seconds** |
| Off-hours | **~5 minutes** |

Drives live prices, `% change`, RS, and `% vs MA` numerator updates.

Configured in server universe cadence (`DEFAULT_CADENCE`).

## Session-adjusted MA recompute

On each snapshot poll, MA **levels** recompute when **≥ 5 minutes** have passed since the last MA refresh (or first poll of the session).

Between MA refreshes, prior MA levels are reused; `% vs MA` still updates because **price** changes every poll.

## Theme DB snapshots (Race / time-slice)

Stored theme metrics for historical views and delta rank:

| Mechanism | Interval |
|-----------|----------|
| Theme snapshot slots | **15-minute** ET boundaries |

Used for leaderboard delta rank and time-slice views—not for live MA columns.

## Nightly EOD bars and `ticker_ma`

| Job | When | Purpose |
|-----|------|---------|
| `refreshDailyBars` | Post-close ET (Render cron) | Updates daily bars and EOD `ticker_ma` |
| `getAllMAs()` DB cache | 5-minute TTL | Fallback when session-adjusted path unavailable |

## Client refetch

Theme list and member list refetch intervals come from admin **Market Condition settings** (defaults often 60s themes / 30s members during TODAY).

## Quick reference

```
60s/5m  → live quotes + pct vs MA (price side)
5m min  → session-adjusted MA levels
15m     → theme DB snapshots (rank deltas, history)
nightly → EOD ticker_ma anchor
```
