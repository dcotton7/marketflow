import type { CandlestickData, HistogramData } from "lightweight-charts";
import { classifyUsEthSessionsForCandles, type UsEthSession } from "@/lib/usMarketEthSessions";

export type IntradayCandleInput = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const RTH_VOL_UP = "rgba(34, 197, 94, 0.3)";
const RTH_VOL_DOWN = "rgba(239, 68, 68, 0.3)";
/** Pre/post volume: one neutral tone (direction ignored). */
const ETH_VOL_EXTENDED = "rgba(255, 255, 255, 0.28)";

/**
 * Styling by **wall-clock session** (bar timestamp → ET pre / RTH / post), not by chart timeframe.
 * Pre/post: same candle look for up and down; RTH uses series default green/red.
 */
function ethCandleStyle(c: IntradayCandleInput, session: UsEthSession): CandlestickData {
  const base: CandlestickData = {
    time: c.timestamp as CandlestickData["time"],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
  if (session !== "pre" && session !== "post") return base;

  return {
    ...base,
    color: "#ffffff",
    borderColor: "#94a3b8",
    wickColor: "#94a3b8",
  };
}

function ethVolumeColor(c: IntradayCandleInput, session: UsEthSession): string {
  const up = c.close >= c.open;
  if (session === "pre" || session === "post") return ETH_VOL_EXTENDED;
  return up ? RTH_VOL_UP : RTH_VOL_DOWN;
}

/** When ETH is on: white pre/post candles by bar time in ET (native LWC per-bar colors). */
export function buildIntradayCandlestickAndVolume(
  candles: readonly IntradayCandleInput[],
  whiteExtendedHoursCandles: boolean
): { candleData: CandlestickData[]; volumeData: HistogramData[] } {
  if (!whiteExtendedHoursCandles || candles.length === 0) {
    const candleData: CandlestickData[] = candles.map((c) => ({
      time: c.timestamp as CandlestickData["time"],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const volumeData: HistogramData[] = candles.map((c) => ({
      time: c.timestamp as HistogramData["time"],
      value: c.volume,
      color: c.close >= c.open ? RTH_VOL_UP : RTH_VOL_DOWN,
    }));
    return { candleData, volumeData };
  }

  const sessions = classifyUsEthSessionsForCandles(candles.map((c) => c.timestamp));
  const candleData: CandlestickData[] = [];
  const volumeData: HistogramData[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const session = sessions[i];
    candleData.push(ethCandleStyle(c, session));
    volumeData.push({
      time: c.timestamp as HistogramData["time"],
      value: c.volume,
      color: ethVolumeColor(c, session),
    });
  }
  return { candleData, volumeData };
}
