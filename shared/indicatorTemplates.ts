export interface IndicatorDef {
  id: string;
  type: "sma" | "ema";
  dayPeriod: number;
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  label: string;
  defaultOn: boolean;
}

export const BARS_PER_DAY: Record<string, number> = {
  "5m": 78,
  "5min": 78,
  "15m": 26,
  "15min": 26,
  "30m": 13,
  "30min": 13,
  "60m": 6.5,
  "1d": 1,
  "daily": 1,
  "1wk": 1 / 5,
  "1mo": 1 / 21,
};

export const DEFAULT_MA_TEMPLATE: IndicatorDef[] = [
  { id: "ma5",   type: "sma", dayPeriod: 5,   color: "#22c55e", lineWidth: 1, label: "5 Day",   defaultOn: true  },
  { id: "ma10",  type: "sma", dayPeriod: 10,  color: "#3b82f6", lineWidth: 1, label: "10 Day",  defaultOn: true  },
  { id: "ma20",  type: "sma", dayPeriod: 20,  color: "#f472b6", lineWidth: 2, label: "20 Day",  defaultOn: true  },
  { id: "ma50",  type: "sma", dayPeriod: 50,  color: "#dc2626", lineWidth: 2, label: "50 Day",  defaultOn: true  },
  { id: "ma200", type: "sma", dayPeriod: 200, color: "#ffffff", lineWidth: 2, label: "200 Day", defaultOn: true  },
];

export function getBarPeriod(dayPeriod: number, timeframe: string): number {
  const barsPerDay = BARS_PER_DAY[timeframe];
  if (barsPerDay == null || barsPerDay <= 0) return dayPeriod;
  return Math.max(1, Math.round(dayPeriod * barsPerDay));
}

export function getPeriodsForTimeframe(timeframe: string): { id: string; type: "sma" | "ema"; period: number; color: string; lineWidth: 1 | 2 | 3 | 4; label: string; defaultOn: boolean }[] {
  return DEFAULT_MA_TEMPLATE.map(def => ({
    id: def.id,
    type: def.type,
    period: getBarPeriod(def.dayPeriod, timeframe),
    color: def.color,
    lineWidth: def.lineWidth,
    label: def.label,
    defaultOn: def.defaultOn,
  }));
}
