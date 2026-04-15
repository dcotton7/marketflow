# Current Priorities

Keep these three projects prominent in planning and backlog reviews:

1. Alerts System
2. Workspace systems
3. Tightening of the admin and role-based system

## Backlog (tracked work)

| Item | Notes |
|------|--------|
| **Shared intraday bar cache (table- or Redis-backed)** | Today `getIntradayBars` uses a per-process in-memory `Map`; only that Node instance benefits. Move to Postgres (durable, indexed by symbol+interval+time) or Redis (shared hot cache) so all users and all app instances reuse warmed history; keep tail refresh + snapshot merge for the live bar. Define retention vs chart lookback, upsert strategy, and pruning. Supports workspace/chart experience; optional tie-in to alerts if intraday data is reused there. |

## Notes

- Default assumption: new settings and workflows are user-level unless explicitly marked admin-level.
- Use these priorities as a lens when sequencing follow-up work.
- If a new task supports one of these directly, call that out clearly in planning.
