# Discovery Scanner — Full Specification

## Overview

The Discovery Scanner is a live market intelligence feed that watches the full ticker
universe in real time and surfaces **contextual, correlated discoveries** — not raw
price alerts, but stories that connect a signal to its peers, theme, sector, and the
broader market backdrop.

### User Experience

A radar icon in the header opens a **floating, resizable, moveable overlay** that stays
on top of charts. Discovery cards appear in real time — compact by default, expandable
to full detail. Every ticker is a clickable link to the chart page. Every theme name
links to Flow Map. Cards include quick-action buttons (Open Chart, View Theme, Star).

At end of day, the full session narrative is preserved in the database for review.

---

## Architecture: Three Primitives

### 1. Signal — something happened
Emitted by the Signal Producer after each MC polling cycle. Types:
- `volume_spike` — ticker volume > Nx its 14-day average
- `velocity_move` — ticker moved >N% in a time window
- `adr_blowout` — extension from 20d ADR exceeds threshold
- `gap` — AM gap > N% (fires once at open)
- `breadth_shift` — theme A/D ratio changed significantly
- `theme_acceleration` — theme score delta exceeds threshold
- `regime_change` — RAI regime flipped
- `rai_shift` — RAI moved >N points in window
- `broad_weakness` / `broad_strength` — multiple themes moving together

### 2. Lens — a way of looking at something
Pure read functions that enrich a signal with context:
- `theme_membership` — theme, peers, ETF proxy, role
- `peer_velocity` — are peers moving too?
- `sector_flow` — theme-level flow, A/D, acceleration
- `regime_context` — RAI, regime, breadth, session
- `fastest_movers` — top movers by direction in window
- `cross_theme` — contagion / spread detection
- `ma_structure` — postureHint, MA stack, extensions
- `relative_strength` — RS vs theme, vs SPY, divergence
- `earnings_proximity` — upcoming earnings filter
- `news` — headlines from Finnhub + FMP (dual-source, corroboration scoring)

### 3. Reaction — what to do about it
- `discovery_brief` — narrative card for the feed
- `watchlist_add` — add qualified tickers to a watchlist
- `score_update` — adjust heat score per ticker/theme
- `short_candidates` — run through short-side detectors (future)
- `ai_inquiry` — LLM interpretation of cluster (deferred)
- `alert` — wire to alert system (Phase 2)

---

## Data Flow

```
MC Poll (30s) → Signal Producer → raw Signal[]
  → Pipeline Router → match to Pipeline[]
    → Lens Evaluation → EnrichedSignal
      → Qualify Filter → pass / reject
        → Reactions → Discovery Brief / Watchlist / Score
          → Client (SSE) → Floating Overlay Feed
            → DB (scanner_discoveries) for history
```

---

## Decisions Log

1. **AI Lens**: Deferred. Stub the slot, build later.
2. **UI Surface**: Floating, resizable, moveable overlay — accessible from any page
   via header icon. Sits above everything except modals (z-index between 1500-3200).
3. **Persistence**: Save all discoveries to DB. ~100KB/day. 30-day retention.
4. **Ownership**: All pipelines tagged with `ownerId` + `visibility` (private/role/global).
   Built-ins are global. User pipelines are private until shared.
5. **Live delivery**: SSE endpoint for real-time push, REST for history.
6. **Scanner states**: On (visible + processing), Silent (hidden + processing + badge), Off (stopped).
7. **Card display**: Compact/Detailed toggle — per-card expand and global toggle.
8. **Session modes**: Pre-market (gap/volume only), Market hours (full), After hours (reduced).
9. **Universe**: Start with existing 594 tickers. Architecture supports multiple universes.
10. **News**: Dual-source (Finnhub + FMP). Corroboration scoring — higher confidence when both report same catalyst.
11. **Alerts integration**: Phase 2 — scanner discoveries become a new alert source.
12. **Actionability**: Every ticker links to charts, every theme links to Flow Map.
13. **Admin colors**: Use `useSystemSettings()` / `cssVariables` from admin theme.
14. **Font controls**: Small +/- controls like FlowMapFontSizeControl pattern.

---

## Default Pipelines

| # | Name | Trigger | Key Lenses | Qualify | Priority |
|---|------|---------|-----------|---------|----------|
| 1 | Volume Cluster | volume_spike > 3x | theme, peer_velocity, sector_flow, news | peers moving >= 2 | normal |
| 2 | Weakness Cascade | breadth_shift (neg) | fastest_movers, cross_theme, regime, news | themes_neg >= 3 | urgent |
| 3 | Strength Surge | theme_acceleration > 3 | fastest_movers, peer_velocity, ma_structure | moving >= 3 | normal |
| 4 | Leadership Divergence | velocity_move > 2% | theme, peer_velocity, relative_strength | diverging + RS > 2 | normal |
| 5 | Gap Morning Scan | gap > 3% | theme, ma_structure, earnings, regime, news | always (summary) | normal |
| 6 | Regime Shift | regime_change / rai > 8 | regime, cross_theme, fastest_movers | always | urgent |
| 7 | ADR Blowout | adr_blowout > 2.5x | theme, ma_structure, earnings | NOT near earnings | low |

---

## File Layout

```
server/scanner/
  index.ts                    init + wire to MC loop
  signal-producer.ts          ring buffer + signal detectors
  pipeline-router.ts          match signals → pipelines
  default-pipelines.ts        built-in pipeline definitions
  routes.ts                   SSE + REST endpoints
  lenses/
    index.ts                  LensRegistry
    theme-membership.ts
    peer-velocity.ts
    sector-flow.ts
    regime-context.ts
    fastest-movers.ts
    cross-theme.ts
    ma-structure.ts
    relative-strength.ts
    earnings-proximity.ts
    news.ts
  reactions/
    index.ts                  ReactionRegistry
    discovery-brief.ts        narrative builder
    watchlist.ts
    score.ts

shared/
  scanner-types.ts            Signal, Pipeline, Lens, Reaction, EnrichedSignal types

client/src/
  context/ScannerContext.tsx   global provider + SSE connection
  hooks/useDiscoveryFeed.ts
  components/scanner/
    DiscoveryFeed.tsx          main feed panel inside overlay
    DiscoveryCard.tsx          individual signal card
    ScannerFontSizeControl.tsx
    scanner-font-prefs.ts

migrations/
  018_scanner_discoveries.sql
```
