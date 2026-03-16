# Market Condition Terminal - Remaining Work Specification

## Document Version
- **Version:** 1.0
- **Date:** February 15, 2026
- **Status:** Gap Analysis & Completion Plan

---

## Executive Summary

The Market Condition Terminal backend and frontend are largely built. This spec identifies remaining gaps, untested areas, and integration work needed to complete the feature.

---

## Current State Assessment

### Backend (Server) - 95% Complete

| Component | Status | Notes |
|-----------|--------|-------|
| Universe definitions | ✅ Complete | 19 clusters + 4 overlays from SignalPure spec |
| Alpaca provider | ✅ Complete | Batched fetching + caching |
| Theme scoring engine | ✅ Complete | All weights from spec |
| Leader scoring engine | ✅ Complete | Hysteresis + turnover caps |
| RAI engine | ✅ Complete | 5 components, caching |
| Scanner exports | ✅ Complete | `getMarketRegimeForScanner()` |
| API routes | ✅ Complete | All endpoints documented |
| Module initialization | ✅ Complete | Auto-start from settings |

### Frontend (Client) - 85% Complete

| Component | Status | Notes |
|-----------|--------|-------|
| MarketConditionPage | ✅ Complete | Resizable panels, view modes |
| HeaderBar | ✅ Complete | RAI, regime, metrics |
| ThemeHeatmapGrid | ✅ Complete | Visual grid |
| ThemeDetailPanel | ✅ Complete | Deep metrics |
| TickerWorkbench | ✅ Complete | Member table |
| RotationTable | ✅ Complete | Sortable table |
| React Query hooks | ✅ Complete | All data hooks |
| Admin controls | ✅ Complete | Settings tab in admin |
| Live/Mock toggle | ✅ Complete | Graceful fallback |

---

## Alpaca Subscription: Algo Trader Plus

**Rate Limits:**
- Historical API calls: 10,000 per minute
- WebSocket subscriptions: Unlimited
- WebSocket connections: 1 per user
- Data coverage: All US exchanges (SIP feed)

**Budget Usage:**
- Polling @ 30s = 2 calls/min = 0.02% of budget
- Massive headroom, not a concern

---

## Remaining Work Items

### Phase 1: Validation & Optimization (HIGH PRIORITY)

#### 1.1 Environment Setup
- [ ] Verify `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` in `.env`

#### 1.2 Market Hours Polling
- [ ] Add market hours detection (9:30 AM - 4:00 PM ET)
- [ ] Default polling: 30s during market hours
- [ ] Off-hours polling: 5 minutes
- [ ] Admin configurable

#### 1.3 Runtime Testing
- [ ] Start server and confirm polling initializes
- [ ] Verify data flows from Alpaca → Engine → API → UI
- [ ] Test error handling when API fails
- [ ] Confirm theme scores calculate correctly
- [ ] Validate RAI calculation with real market data
- [ ] Test admin controls (start/stop/refresh)

### Phase 2: Scanner Integration (HIGH PRIORITY)

- [ ] Import regime data in BigIdea scan execution
- [ ] Apply `penaltyFactor` to scan results from weak themes
- [ ] Apply `riskMultiplier` to position sizing suggestions
- [ ] Surface regime info in scan debug output
- [ ] Add regime indicator to BigIdea UI header

### Phase 3: Polish (MEDIUM PRIORITY)

- [ ] Add overlay badges to member tickers (MEGA, HIGH_BETA)
- [ ] Add company names to ticker display
- [ ] Improve error state UI (banner, retry)
- [ ] Add historical SMA data for RAI accuracy

### Phase 4: Nice-to-Have (LOW PRIORITY / DEFER)

- [ ] "Suggest Addition" feature
- [ ] VIX data source (keep UVXY proxy for now)
- [ ] WebSocket streaming (future enhancement)
- [ ] Performance optimization for off-hours

---

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/market-condition/themes` | GET | All theme metrics |
| `/api/market-condition/themes/:id` | GET | Single theme metrics |
| `/api/market-condition/themes/:id/members` | GET | Theme member tickers |
| `/api/market-condition/rai` | GET | RAI score + components |
| `/api/market-condition/leaders` | GET | Leaders across themes |
| `/api/market-condition/regime` | GET | Simplified regime for Scanner |
| `/api/market-condition/status` | GET | Polling status |
| `/api/market-condition/settings` | GET/PUT | Admin settings |
| `/api/market-condition/start` | POST | Start polling |
| `/api/market-condition/stop` | POST | Stop polling |
| `/api/market-condition/refresh` | POST | Force refresh |
| `/api/market-condition/universe` | GET | Cluster definitions |
| `/api/market-condition/universe/:id` | GET | Single cluster tickers |

---

## Environment Variables Required

```env
# Alpaca API (required for live data)
ALPACA_API_KEY=your_api_key
ALPACA_SECRET_KEY=your_secret_key
```

---

## Success Criteria

1. **Market Condition page loads with live data** (not mock)
2. **Themes update every 30 seconds** during market hours
3. **Themes update every 5 minutes** outside market hours
4. **RAI score displays** with component breakdown
5. **BigIdea Scanner uses regime data** for scoring adjustments
6. **Admin can control polling** via settings tab
7. **Graceful fallback** to mock data when API unavailable

---

*End of Specification*
