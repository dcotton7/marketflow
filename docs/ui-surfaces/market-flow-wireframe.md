# MarketFlow screen wireframe

**Canonical wireframe** for the MarketFlow surface. When Don says **“print Flow wireframe”**, agents must output this document (ASCII diagram + region table + refresh tiers) without improvising alternate layouts or names.

| Field | Value |
|-------|--------|
| Surface id | `marketFlow` |
| Display name | MarketFlow |
| Route | `/sentinel/market-condition` |
| Page component | `MarketConditionPage.tsx` |
| Region registry | `shared/ui-surfaces/market-flow.ts` |

**Legend:** `[regionId]` = stable logical area id · `(Display name)` · `~tier` = refresh tier

---

## Full layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ APP NAV  [appNav]  (SentinelHeader — global, not MarketFlow-specific)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ REGIME BAR  [regimeBar]  ~themeStream                                         │
│  [regimeBranding] MarketFlow │ [sessionBadge] OPEN/AFTER/CLOSE               │
│  [raiGauge] RAI │ [megaOverlay] MEGA │ [universeBreadthBar] %↑ green / %↓ red  │
│  [regimeBadge] RISK ON │ [benchmarkStrip] QQQ · IWM · MDY · SPY │ health…     │
├──────────────────────────────────────────────────────────────────────────────┤
│ STATUS BANNERS  [statusBanners]  (conditional)                                  │
│  [apiErrorBanner] API error + retry │ [comparisonBanner] baseline unavailable │
├──────────────────────────────────────────────────────────────────────────────┤
│ COMMAND TOOLBAR  [commandToolbar]                                             │
│  [pageTitle] Market Condition / Flow Mode · LIVE · STALE                      │
│  [dataSourceToggle] Live/Mock │ [forceRefresh]                                │
│  LENS  [lensSwitcher]: flow │ flowMap │ rotation │ conc │ A/D │ race          │
│  [accDistFilter] │ [timeSliceSelector] │ [universeSearch] │ [sizeFilter]        │
│  [viewModeToggle] grid │ table │ split │ [panelVisibility] │ [fullscreenToggle]│
├──────────────────────────────────────────────────────────────────────────────┤
│ WORKSPACE  [workspace]                                                        │
│                                                                               │
│  ═══ SPLIT VIEW (default) — vertical stack ═══                                │
│  ┌─ TOP ROW — horizontal PanelGroup ──────────────────────────────────────┐  │
│  │                                                                         │  │
│  │  THEME TRACKER  [themeTrackerPanel]  ~themeStream                       │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Panel header (title varies by lens)                               │  │  │
│  │  │  flow/rotation: [heatmapSortToggle] LIVE vs historical baseline   │  │  │
│  │  │  race: Expand → [racePopout]                                      │  │  │
│  │  ├───────────────────────────────────────────────────────────────────┤  │  │
│  │  │ ONE OF (by [lensSwitcher]):                                       │  │  │
│  │  │  [themeHeatmap]     flow · rotation · conc · A/D lenses           │  │  │
│  │  │  [flowMapMatrix]    flowMap lens                                    │  │  │
│  │  │    └ [flowMapControls] timeframe cols · comp · sort · help        │  │  │
│  │  │  [themeRace]        race lens  ~snapshotHistory                     │  │  │
│  │  │    └ [raceTransport] play · scrub · range                         │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  │  ║ resize handle                                                         │  │
│  │  FOCUSED THEME  [focusedThemePanel]  ~themeStream                       │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Panel header: Focused Theme · {selected theme name} · Hide        │  │  │
│  │  │ [detailTabBar]:                                                   │  │  │
│  │  │   Actionable Details │ Sub-themes │ ETFs │ Flow Focus │ Legacy      │  │  │
│  │  ├───────────────────────────────────────────────────────────────────┤  │  │
│  │  │ Tab body (one visible):                                           │  │  │
│  │  │  [actionableDetails]  Theme box — status, segments, breakdown     │  │  │
│  │  │  [subthemesList]      Sub-theme cards → sets member scope         │  │  │
│  │  │  [etfProxies]         Theme ETF proxy list                        │  │  │
│  │  │  [flowFocus]          Flow Map route detail (from matrix click)   │  │  │
│  │  │  [legacyDetails]      Full legacy theme detail panel              │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  │  ║ resize handle                                                         │  │
│  │  MEMBERS  [membersPanel]  ~memberStream                                   │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Panel header: Theme Members · scope subtitle · Hide                 │  │  │
│  │  │ [memberScopeToggle] Leaders │ All Theme │ Sub-theme                 │  │  │
│  │  │ [tickerWorkbench]                                                   │  │  │
│  │  │   [memberMaColumns] MA1 / MA2 pickers                               │  │  │
│  │  │   [memberSyncToggles] MS sync · Chart sync · Analysis sync          │  │  │
│  │  │   [memberTable] sortable ticker rows                                │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ BOTTOM ROW (split only, optional) ────────────────────────────────────┐  │
│  │ ROTATION TABLE PANEL  [rotationTablePanel]  ~themeStream                │  │
│  │  [rotationTable] — full sortable metrics grid (Δ rank, score, RS, …)   │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ═══ OTHER VIEW MODES ═══                                                     │
│  grid  → full-width [themeHeatmap] (or [flowMapMatrix] if flowMap lens)       │
│  table → full-width [rotationTable]                                           │
└──────────────────────────────────────────────────────────────────────────────┘

OVERLAYS (same page, not in main stack)
  [racePopout]      Theme Race dialog — expanded [themeRace]
  [analysisPanel]   Floating AI analysis sheet (symbol from member/workbench)
```

---

## Lens switcher (`lensSwitcher`)

| ID | Toolbar label | Theme tracker content | Sort / focus |
|----|---------------|----------------------|--------------|
| `flow` | FLOW | `[themeHeatmap]` | ThemeScore (current or historical) |
| `flowMap` | FLOW MAP | `[flowMapMatrix]` | Pairwise route matrix |
| `rotation` | ROTATION | `[themeHeatmap]` | Δ rank vs baseline |
| `concentration` | CONC | `[themeHeatmap]` | Top-3 concentration |
| `accumulation` | A/D | `[themeHeatmap]` | A/D streak days |
| `race` | RACE | `[themeRace]` | Snapshot timeline lanes |

Time slice selector disabled for: `flowMap`, `concentration`, `accumulation`, `race`.

---

## View modes (`viewModeToggle`)

| ID | Layout |
|----|--------|
| `split` | Theme tracker + focused theme + members (top row) + rotation table (bottom) |
| `grid` | Full-width heatmap or flow map only |
| `table` | Full-width rotation table only |

---

## Refresh tiers

| Tier id | Regions | Default cadence |
|---------|---------|-----------------|
| `themeStream` | regimeBar (summary), themeTrackerPanel, focusedThemePanel, rotationTablePanel | ~60s — admin `clientThemesRefetchIntervalMs` |
| `memberStream` | membersPanel, tickerWorkbench | ~60s — admin `clientTickersRefetchIntervalMs` |
| `snapshotHistory` | themeRace, Flow Map historical baselines | 15m ET — `theme_snapshots` DB |
| `benchmarkStrip` | benchmarkStrip in regimeBar | TODAY live poll (~60s) |

**Theme box** (`actionableDetails` tab): same cadence as `themeStream` today (not 15m unless changed later).

---

## Region index (quick lookup)

| Region id | Display name | Parent |
|-----------|--------------|--------|
| `pageShell` | Page shell | — |
| `appNav` | App navigation | pageShell |
| `regimeBar` | Regime bar | pageShell |
| `statusBanners` | Status banners | pageShell |
| `commandToolbar` | Command toolbar | pageShell |
| `workspace` | Workspace | pageShell |
| `themeTrackerPanel` | Theme tracker panel | workspace |
| `focusedThemePanel` | Focused theme panel | workspace |
| `membersPanel` | Members panel | workspace |
| `rotationTablePanel` | Rotation table panel | workspace |
| `racePopout` | Race pop-out | pageShell |
| `analysisPanel` | Analysis panel | pageShell |

Full tree: `shared/ui-surfaces/market-flow.ts`.

---

## Related

- Nomenclature rule: `.cursor/rules/ui-surfaces-nomenclature.mdc`
- Print trigger rule: `.cursor/rules/market-flow-wireframe.mdc`
