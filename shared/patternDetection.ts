// Shared pattern detection module - used by both server scanner and client chart

export interface CupAndHandleResult {
  detected: boolean;
  // Visualization data (only present if detected)
  cupStartIdx?: number;
  cupStartTime?: number;
  lipLevel?: number;
  cupBottomIdx?: number;
  cupBottomTime?: number;
  cupBottomPrice?: number;
  cupRightIdx?: number;
  cupRightTime?: number;
  handleStartIdx?: number;
  handleStartTime?: number;
  handleEndIdx?: number;
  handleEndTime?: number;
  handleHigh?: number;
  handleLow?: number;
  completionPct?: number;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Detect Cup and Handle pattern with consistent algorithm
 * Used by both scanner (for filtering) and chart (for visualization)
 * 
 * @param candles - Array of OHLCV candles
 * @param loose - Whether to use relaxed thresholds
 * @returns Detection result with visualization metadata if pattern found
 */
export function detectCupAndHandle(candles: Candle[], loose: boolean = false): CupAndHandleResult {
  if (candles.length < 40) {
    return { detected: false };
  }

  // Try multiple lookback windows to find the best pattern
  const lookbackOptions = [60, 90, 120, 45];
  
  for (const lookbackSize of lookbackOptions) {
    const lookback = Math.min(lookbackSize, candles.length);
    const recentCandles = candles.slice(-lookback);
    
    // Find potential cup boundaries
    // Left lip: find highest point in first 40% of data
    const leftPortion = Math.floor(lookback * 0.4);
    const leftSection = recentCandles.slice(0, leftPortion);
    const leftHighIdx = leftSection.reduce((maxIdx, c, idx, arr) => 
      c.high > arr[maxIdx].high ? idx : maxIdx, 0);
    const leftHigh = leftSection[leftHighIdx].high;
    
    // Find the cup bottom: lowest point between left lip and last 10 candles
    const middleStart = Math.max(leftHighIdx + 3, 0);
    const middleEnd = Math.max(lookback - 10, middleStart + 5);
    const middleSection = recentCandles.slice(middleStart, middleEnd);
    if (middleSection.length < 5) continue;
    
    const cupLowIdxInMiddle = middleSection.reduce((minIdx, c, idx, arr) => 
      c.low < arr[minIdx].low ? idx : minIdx, 0);
    const cupLow = middleSection[cupLowIdxInMiddle].low;
    const cupLowIdx = middleStart + cupLowIdxInMiddle;
    
    // Right lip: highest point after cup bottom
    const rightStart = cupLowIdx + 1;
    const rightEnd = lookback - 3;
    if (rightEnd <= rightStart) continue;
    const rightSection = recentCandles.slice(rightStart, rightEnd);
    if (rightSection.length < 3) continue;
    
    const rightHighIdxInSection = rightSection.reduce((maxIdx, c, idx, arr) =>
      c.high > arr[maxIdx].high ? idx : maxIdx, 0);
    const rightHigh = rightSection[rightHighIdxInSection].high;
    const cupRightIdx = rightStart + rightHighIdxInSection;
    
    // Cup depth: should be 10-50% (tight) or 8-60% (loose)
    const cupDepthPct = ((leftHigh - cupLow) / leftHigh) * 100;
    
    const minDepth = loose ? 8 : 10;
    const maxDepth = loose ? 60 : 50;
    
    if (cupDepthPct < minDepth || cupDepthPct > maxDepth) continue;
    
    // Cup should be U-shaped: check that there are multiple candles near the bottom
    const bottomThreshold = cupLow * (loose ? 1.10 : 1.08);
    const candlesNearBottom = middleSection.filter(c => c.low <= bottomThreshold).length;
    const minBottomCandles = loose ? 2 : 3;
    if (candlesNearBottom < minBottomCandles) continue;
    
    // Right side should recover to near left high (symmetry check)
    const symmetryThreshold = loose ? 0.80 : 0.85;
    if (rightHigh < leftHigh * symmetryThreshold) continue;
    
    // Minimum pattern duration: from cup bottom to current must be at least 10 bars
    const barsFromCupBottom = lookback - cupLowIdx;
    if (barsFromCupBottom < 10) continue;
    
    // Handle: small pullback from right high (last 3-15 candles)
    const handleCandles = recentCandles.slice(-15);
    const handleHigh = Math.max(...handleCandles.map(c => c.high));
    const handleLow = Math.min(...handleCandles.map(c => c.low));
    const handleDepthPct = ((handleHigh - handleLow) / handleHigh) * 100;
    
    // Handle should be shallow: < 15% (tight) or < 25% (loose)
    const handleThreshold = loose ? 25 : 15;
    if (handleDepthPct > handleThreshold) continue;
    
    // Current price should be in upper portion of handle
    const currentClose = recentCandles[recentCandles.length - 1].close;
    const handleThird = handleLow + (handleHigh - handleLow) * (loose ? 0.33 : 0.5);
    const inUpperHandle = currentClose >= handleThird;
    
    if (!inUpperHandle) continue;
    
    // Volume check (skip in loose mode)
    if (!loose) {
      const handleAvgVol = handleCandles.reduce((sum, c) => sum + c.volume, 0) / handleCandles.length;
      const cupAvgVol = middleSection.reduce((sum, c) => sum + c.volume, 0) / middleSection.length;
      const volumeContracted = handleAvgVol <= cupAvgVol * 1.3;
      if (!volumeContracted) continue;
    }
    
    // Calculate completion percentage
    const lipLevel = Math.max(leftHigh, rightHigh);
    const totalRange = lipLevel - cupLow;
    const recovered = currentClose - cupLow;
    const completionPct = totalRange > 0 
      ? Math.min(100, Math.max(0, Math.round((recovered / totalRange) * 100)))
      : 0;
    
    // Pattern detected! Return with visualization data
    const dataStartIdx = candles.length - lookback;
    
    return {
      detected: true,
      cupStartIdx: dataStartIdx,
      cupStartTime: new Date(recentCandles[0].date).getTime() / 1000,
      lipLevel,
      cupBottomIdx: dataStartIdx + cupLowIdx,
      cupBottomTime: new Date(recentCandles[cupLowIdx].date).getTime() / 1000,
      cupBottomPrice: cupLow,
      cupRightIdx: dataStartIdx + cupRightIdx,
      cupRightTime: new Date(recentCandles[cupRightIdx].date).getTime() / 1000,
      handleStartIdx: dataStartIdx + lookback - 15,
      handleStartTime: new Date(handleCandles[0].date).getTime() / 1000,
      handleEndIdx: dataStartIdx + lookback - 1,
      handleEndTime: new Date(handleCandles[handleCandles.length - 1].date).getTime() / 1000,
      handleHigh,
      handleLow,
      completionPct
    };
  }
  
  return { detected: false };
}

/**
 * Calculate SMA for a given period
 */
export function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}
