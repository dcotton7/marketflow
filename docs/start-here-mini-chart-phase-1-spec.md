# Start Here Mini-Chart Phase 1 Spec

## Purpose
Define the product rules for Start Here mini-chart spawning, chart color identity, and ticker-targeting behavior so the UI is predictable and consistent.

This spec also records what is included in Phase 1, what is already shipped, and what is intentionally deferred to later phases.

## Core Mental Model

### 1. Color means current group identity
Color represents the chart or widget's current link/group identity.

Color does not mean:
- which watchlist originally spawned the chart
- historical provenance
- "last source touched"

### 2. Unassigned is a real state
An unassigned chart is intentionally neutral.

It should not:
- pick a random lane color
- silently inherit the first palette color
- appear linked when it is not linked

### 3. Watchlist actions may intentionally create colored private charts
A chart spawned from a colored watchlist action may look Emerald, Sky, etc. without joining the canonical link lane.

That means:
- it can visually carry that identity
- it remains a private chart group unless the user explicitly links it
- color identity and actual group/linking are related, but not identical concepts

## Definitions

- `Link lane`: canonical shared lane such as Emerald/Sky/etc.
- `Private group`: widget-local group id that is not one of the canonical lanes
- `Unassigned`: a private group with no explicit accent color
- `Private accent`: a private group with an explicit `accentColorIndex`
- `Default chart template`: the chart widget whose size and timeframe are reused when spawning charts from a watchlist or bulk-loading a list

## Phase 1 Scope
Phase 1 covers the identity and spawn rules only.

Included:
- generic `Add Widget -> Chart` starts unassigned
- watchlist chart icon can spawn a chart with the watchlist's visible identity
- unassigned watchlists spawn unassigned charts
- chart chrome resolves private accented charts correctly
- chart spawn no longer falls back to a random/private accent when no inherited color is provided

Not included in Phase 1:
- new `3 Linked Charts` widget
- entry-price line on mini-charts
- a new global "active target chart" ticker-routing model outside the current focused-chart behavior
- unlink restrictions for linked chart sets

## Product Rules

### Rule A: Generic chart creation
When a user adds a chart from generic `Add Widget`, the new chart starts unassigned.

Acceptance criteria:
- the chart uses a private group
- that private group has no accent identity
- the chart renders with the neutral/unlinked appearance
- it does not pick a random palette color

### Rule B: Watchlist chart icon spawn
When a user clicks the chart icon from a watchlist row, the new chart should inherit the watchlist's current visible identity only if that identity is explicit.

Cases:
- canonical lane watchlist -> spawned chart inherits that lane color
- private watchlist with explicit accent -> spawned chart inherits that private accent
- unassigned watchlist -> spawned chart stays unassigned

Acceptance criteria:
- Emerald watchlist icon spawns Emerald-looking chart
- unassigned watchlist icon spawns neutral chart
- repeated clicks from an unassigned watchlist do not produce random colors

### Rule C: Color is not provenance
Changing a chart's group later should update its visible identity to match the new group.

Acceptance criteria:
- if an unassigned chart is later linked to Emerald, it becomes Emerald
- if a colored private chart is later moved to a different group, its visual identity updates accordingly

### Rule D: Typing in a chart changes that chart
Typing a ticker into a chart changes that chart only.

Acceptance criteria:
- typing a symbol into a chart input sets or clears that chart's symbol override
- it does not broadcast to other charts automatically

### Rule E: Focused chart targeting for watchlist row clicks
Current shipped behavior:
- if there is a focused chart in the same lane/group context, clicking a watchlist row changes only that focused chart
- if there is no focused chart in that lane and fewer than 4 charts are in the lane, the lane symbol is broadcast
- if there are 4 or more charts in the lane, the user is prompted before broadcasting

This is the current operational rule and should remain documented until a later ticker-routing redesign replaces it.

## UX Requirements

### Chart tile focus
Clicking a chart tile should make it the focused chart target for current watchlist-row behavior.

### Default template
The `Default` control on a chart defines the spawn template for:
- watchlist chart button spawns
- bulk `Load List into charts`

The template provides:
- chart size
- chart timeframe

### Unassigned visibility
Unassigned charts should read as intentionally neutral, not broken and not randomly assigned.

## Data / State Requirements

### Group state
Private groups may store:
- `colorIndex`
- `accentColorIndex`
- `symbol`

Interpretation:
- `colorIndex` is internal/default bookkeeping
- `accentColorIndex` is the visible private identity
- `accentColorIndex: null` means truly unassigned

### Accent resolution
Visual accent resolution should follow this order:
1. If the group is a canonical link lane, use that lane's palette color.
2. Else if the private group has an `accentColorIndex`, use the corresponding palette color.
3. Else render as unlinked/unassigned.

### Watchlist spawn color resolution
Watchlist-driven chart creation should follow this order:
1. If an explicit inherited color index is provided, use it.
2. Else if an inherited source group id resolves to a current group color, use that.
3. Else create the chart as unassigned.

The fallback must not assign the "next" random/private palette color.

## Bulk Load Rules
`Load List into charts` should obey the same color rules as single-chart watchlist spawning.

That means:
- if launched from a colored watchlist context, all loaded charts inherit that visible identity
- if launched from an unassigned watchlist context, all loaded charts remain unassigned
- bulk load uses the current default chart template for size and timeframe

## Entry Price Rules

### Purpose
If a trade-plan entry exists for the chart's symbol, the mini-chart should be able to show it as a clear horizontal reference line.

This is a visual aid, not a linking rule.

### Source of truth
The preferred source is the watchlist trade-plan field already used elsewhere in the app:
- `targetEntry`

Supporting notes:
- watchlist items already carry `targetEntry`, `stopPlan`, and `targetPlan`
- mini-chart entry rendering should not invent values
- if there is no stored entry for the current symbol, no entry line should render

### Matching rule
Entry Price should resolve by the chart's effective symbol:
- chart override symbol if one exists
- otherwise the group's symbol

This keeps the overlay aligned with what the chart is actually showing.

### Display rule
When an entry price exists:
- draw one horizontal line across the chart at the entry level
- label it `Entry`
- keep the style visually distinct from price bars and moving averages
- preserve readability at mini-chart size

Recommended default styling:
- dashed or softly solid line
- medium emphasis, not dominant
- small right-edge label or compact badge

### No-data behavior
If no entry price exists for the chart symbol:
- show no entry line
- do not show placeholder text inside the chart
- do not fall back to another symbol's value

### Interaction rule
Phase 1 does not include editing the entry from the mini-chart.

Later enhancement options:
- hover tooltip with exact entry value
- toggle entry line on/off
- optional stop and target companion lines

### Acceptance criteria
- if `targetEntry` exists for the displayed symbol, the chart shows one `Entry` line at that value
- if the chart symbol changes, the entry line updates to the new symbol
- if the chart has no entry data, no line is shown
- the entry line never appears for the wrong symbol
- the line remains visible and legible on `5m`, `15m`, and `1d`

## Deferred Phases

### Phase 2 candidate: tighter ticker targeting
Desired direction discussed earlier:
- user clicks a chart to make it the active target
- ticker-link actions should change that chart only
- if no active target exists, fallback group behavior may apply

This is not fully implemented as a standalone routing model yet.

### Phase 3 candidate: `3 Linked Charts` widget
Desired behavior:
- new widget creates three charts
- default intervals: `1d`, `15m`, `5m`
- changing ticker in any one changes the full set
- deleting one or more is allowed
- unlinking the set is not allowed

### Phase 4 candidate: entry price line
Potential enhancement:
- if an entry price exists, render it as a horizontal overlay on mini-charts
- use the symbol's watchlist `targetEntry` as the default source of truth
- this requires chart overlay support and a clean symbol-to-trade-plan lookup path

## Current Implementation Notes
As of this spec:
- generic chart widgets are created as private groups with `accentColorIndex: null`
- watchlist-spawned charts inherit an explicit color only when one exists
- unassigned watchlist spawns remain unassigned
- spawn helpers no longer choose a random accent when no inherited color is passed

Relevant files:
- `client/src/components/start-here/dashboard-persistence.ts`
- `client/src/components/start-here/WatchlistPortalWidget.tsx`
- `client/src/components/start-here/StartHereContext.tsx`
- `client/src/components/start-here/ChartPreviewWidget.tsx`
- `client/src/components/MiniChart.tsx`
- `client/src/hooks/use-watchlist.ts`

## Acceptance Checklist
- `Add Widget -> Chart` creates a neutral/unassigned chart.
- Clicking the chart icon from an Emerald watchlist creates an Emerald-looking chart.
- Clicking the chart icon from an unassigned watchlist creates a neutral chart.
- Repeated unassigned spawns do not rotate through random colors.
- Chart tile focus continues to govern current same-lane watchlist row targeting.
- Typing a ticker in a chart changes only that chart.
- Bulk chart loading follows the same color inheritance rules as single-chart spawning.
- Entry Price, when implemented, resolves from the displayed symbol's `targetEntry` only.
