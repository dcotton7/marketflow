/**
 * Detects when intraday price crosses a daily moving average within a recent window.
 * Used by Big Idea MA-10 and available for Alerts-style evaluations.
 */

import {
  calculateMaAtOffset,
  intradayIntervalToBarMinutes,
  lookbackMinutesToBars,
} from "./ma-math";

export type MaCrossDirection = "above" | "below" | "any";

export interface IntradayDailyMaCrossInput {
  /** Daily closes, oldest → newest (chronological). */
  dailyCloses: number[];
  /** Intraday closes, oldest → newest (chronological). */
  intradayCloses: number[];
  maPeriod: number;
  maType: "sma" | "ema";
  lookbackMinutes: number;
  intradayTimeframe: string;
  crossType: MaCrossDirection;
}

export interface IntradayDailyMaCrossResult {
  pass: boolean;
  maLevel: number | null;
  crossBarOffset: number | null;
  lookbackBars: number;
  detail: string;
}

function toChronologicalCloses(closesNewestFirst: number[]): number[] {
  return [...closesNewestFirst].reverse();
}

/**
 * Accepts candle closes in Big Idea order (index 0 = newest bar).
 */
export function detectIntradayCrossOfDailyMaFromCandles(
  dailyClosesNewestFirst: number[],
  intradayClosesNewestFirst: number[],
  options: Omit<IntradayDailyMaCrossInput, "dailyCloses" | "intradayCloses">
): IntradayDailyMaCrossResult {
  return detectIntradayCrossOfDailyMa({
    dailyCloses: toChronologicalCloses(dailyClosesNewestFirst),
    intradayCloses: toChronologicalCloses(intradayClosesNewestFirst),
    ...options,
  });
}

export function detectIntradayCrossOfDailyMa(input: IntradayDailyMaCrossInput): IntradayDailyMaCrossResult {
  const {
    dailyCloses,
    intradayCloses,
    maPeriod,
    maType,
    lookbackMinutes,
    intradayTimeframe,
    crossType,
  } = input;

  const barMinutes = intradayIntervalToBarMinutes(intradayTimeframe);
  const lookbackBars = lookbackMinutesToBars(lookbackMinutes, barMinutes);

  if (dailyCloses.length < maPeriod + 1 || intradayCloses.length < 2) {
    return {
      pass: false,
      maLevel: null,
      crossBarOffset: null,
      lookbackBars,
      detail: "insufficient data",
    };
  }

  const maLevel = calculateMaAtOffset(dailyCloses, maPeriod, 0, maType);
  if (maLevel == null || maLevel <= 0) {
    return {
      pass: false,
      maLevel: null,
      crossBarOffset: null,
      lookbackBars,
      detail: "could not compute daily MA",
    };
  }

  const endIndex = intradayCloses.length - 1;
  const startIndex = Math.max(1, endIndex - lookbackBars + 1);

  for (let i = endIndex; i >= startIndex; i--) {
    const priceNow = intradayCloses[i];
    const pricePrev = intradayCloses[i - 1];
    const crossedAbove = pricePrev <= maLevel && priceNow > maLevel;
    const crossedBelow = pricePrev >= maLevel && priceNow < maLevel;

    if (crossType === "above" && crossedAbove) {
      return {
        pass: true,
        maLevel,
        crossBarOffset: endIndex - i,
        lookbackBars,
        detail: `cross above ${maPeriod}${maType.toUpperCase()} within ${lookbackMinutes}m`,
      };
    }
    if (crossType === "below" && crossedBelow) {
      return {
        pass: true,
        maLevel,
        crossBarOffset: endIndex - i,
        lookbackBars,
        detail: `cross below ${maPeriod}${maType.toUpperCase()} within ${lookbackMinutes}m`,
      };
    }
    if (crossType === "any" && (crossedAbove || crossedBelow)) {
      const direction = crossedAbove ? "above" : "below";
      return {
        pass: true,
        maLevel,
        crossBarOffset: endIndex - i,
        lookbackBars,
        detail: `cross ${direction} ${maPeriod}${maType.toUpperCase()} within ${lookbackMinutes}m`,
      };
    }
  }

  const latestPrice = intradayCloses[endIndex];
  return {
    pass: false,
    maLevel,
    crossBarOffset: null,
    lookbackBars,
    detail: `no ${crossType} cross in ${lookbackMinutes}m (price $${latestPrice.toFixed(2)} vs MA $${maLevel.toFixed(2)})`,
  };
}
