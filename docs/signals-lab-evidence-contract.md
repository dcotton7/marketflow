# Signals Lab — Intraday Evidence Metric Contract (V3)

## Purpose

Signals Lab ranks scanner discoveries for **intraday** decision support. It does **not**
suppress signals or mutate detector thresholds. Evidence badges are rank-only.

## Outcome contracts

| Version | Meaning | Safe for production ranking? |
|---------|---------|------------------------------|
| `v2` / null (legacy) | Live-print checkpoints + sparse MFE | **No** — provisional research only |
| `v3` | Exact 5m bar at horizon + bar-bounded MFE/MAE | **Yes**, once sample is large enough |

Existing rows are **never rewritten**. New fills stamp `outcome_contract_version=v3`.
`intraday_complete_at` marks 15m–D1 completion without abandoning D2/1W/1Mo scheduling.

## Episode definition

One **episode** = first fire of `(signal_type, subject, ET calendar day)`.
Hit rates and edge use episodes, not raw fire counts (LOD/HOD/MA floods otherwise dominate).

## Direction-adjusted edge

- Long: `move`
- Short: `-move`
- Positive = favorable for the signal direction

Hit = direction-adjusted move ≥ `hit_threshold` (default 0.5%) at the selected window.

## Trust modes

- **auto**: use V3 when enough trusted rows exist; else provisional with warnings
- **trusted**: V3 only
- **provisional**: legacy/V2 clocks (research)
- **all**: mixed (explicit warning)

## Evidence tiers (display)

Computed from shrunk hit rate, direction-adjusted edge, and sample confidence:

- `strong` — enough samples, hit ≥35%, edge ≥0.15%, confidence ≥0.55
- `watch` — moderate edge/hit
- `weak` — poor hit or negative edge
- `unknown` — thin sample

## Live feed

Discovery cards may show an evidence badge and an optional **Evidence Rank** sort.
Heuristic `qualifyScore` remains visible and separate. No card is hidden by evidence.

## Provisional candidate cohorts (research)

Until enough V3 outcomes accumulate, treat these as hypotheses only:

1. Failed breakout · score 75+
2. HOD fade · score 75+ · weak theme
3. LOD bounce · score 75+ · strong theme
4. Gap-down continuation · score 60+ · bearish MA stack

Promotion to “strong” live ranking requires chronological holdout stability and
positive net edge after round-trip costs + liquidity floor
(`shared/scanner-evidence-holdout.ts`).

## APIs

- `GET /api/scanner/workbench/hit-rates` — episode aggregates + cohorts + warnings
- `GET /api/scanner/evidence/live` — compact index for feed badges
- `GET /api/scanner/evidence/holdout?signal_type=…` — weekly chronological stability + cost/liquidity gate
- `POST /api/scanner/workbench/ai-analyze` — recomputes evidence server-side

Holdout promotion requires `summary.stable`, positive net edge after round-trip costs,
liquidity floor, and `trust === trusted` (V3 clocks) before `readyForStrongRank`.
