// Shared pattern detection module - used by both server scanner and client chart

export interface CupAndHandleResult {
  detected: boolean;
  cupOnly?: boolean; // True when right rim extended past left rim threshold
  // Visualization data (only present if detected)
  leftPeakIdx?: number;
  leftPeakTime?: number;
  leftPeakPrice?: number;
  cupBottomIdx?: number;
  cupBottomTime?: number;
  cupBottomPrice?: number;
  rightRimIdx?: number;
  rightRimTime?: number;
  rightRimPrice?: number;
  handleStartIdx?: number;
  handleStartTime?: number;
  handleEndIdx?: number;
  handleEndTime?: number;
  handleLows?: { time: number; price: number }[]; // Actual candle lows for handle
  cupLows?: { time: number; price: number }[]; // Actual candle lows for cup portion (support line)
  completionPct?: number;
  extensionPct?: number; // How much right rim exceeds left peak (%)
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
 * Detect Cup and Handle pattern with correct visualization logic
 * 
 * Cup Shape:
 * - Left Peak: The highest high before the decline begins
 * - Cup Bottom: The lowest low in the formation
 * - Right Rim: Where price recovers before handle pullback
 * 
 * Handle:
 * - Follows actual candle LOWS from right rim, sloping down
 * 
 * Strictness Filter:
 * - Tight: Shows cups up to 6% extended above left peak
 * - Loose: Shows cups up to 11% extended above left peak
 * 
 * Cup Only:
 * - When right rim exceeds left peak by threshold, show "Cup Only" instead of %
 * 
 * @param candles - Array of OHLCV candles
 * @param loose - Whether to use relaxed thresholds (affects extension limit)
 * @returns Detection result with visualization metadata if pattern found
 */
export function detectCupAndHandle(candles: Candle[], loose: boolean = false): CupAndHandleResult {
  if (candles.length < 40) {
    return { detected: false };
  }

  // Extension threshold: Tight = 6%, Loose = 11%
  const maxExtensionPct = loose ? 11 : 6;

  // Try multiple lookback windows to find the best pattern
  const lookbackOptions = [60, 90, 120, 45, 150];
  
  for (const lookbackSize of lookbackOptions) {
    const lookback = Math.min(lookbackSize, candles.length);
    const recentCandles = candles.slice(-lookback);
    
    // Step 1: Find the LEFT PEAK - highest high in first 50% of data
    // This is where the cup starts (top left of the cup)
    const leftPortion = Math.floor(lookback * 0.5);
    const leftSection = recentCandles.slice(0, leftPortion);
    const leftPeakIdxInSection = leftSection.reduce((maxIdx, c, idx, arr) => 
      c.high > arr[maxIdx].high ? idx : maxIdx, 0);
    const leftPeakPrice = leftSection[leftPeakIdxInSection].high;
    const leftPeakIdx = leftPeakIdxInSection;
    
    // Step 2: Find the CUP BOTTOM - lowest low after left peak
    const bottomSearchStart = leftPeakIdx + 2;
    const bottomSearchEnd = lookback - 5; // Leave room for handle
    if (bottomSearchEnd <= bottomSearchStart + 3) continue;
    
    const bottomSection = recentCandles.slice(bottomSearchStart, bottomSearchEnd);
    if (bottomSection.length < 5) continue;
    
    const cupBottomIdxInSection = bottomSection.reduce((minIdx, c, idx, arr) => 
      c.low < arr[minIdx].low ? idx : minIdx, 0);
    const cupBottomPrice = bottomSection[cupBottomIdxInSection].low;
    const cupBottomIdx = bottomSearchStart + cupBottomIdxInSection;
    
    // Step 3: Find the RIGHT RIM - highest high after cup bottom (before handle)
    // The right rim is where the price recovers before the handle pullback
    const rightSearchStart = cupBottomIdx + 3;
    const rightSearchEnd = lookback - 3;
    if (rightSearchEnd <= rightSearchStart) continue;
    
    const rightSection = recentCandles.slice(rightSearchStart, rightSearchEnd);
    if (rightSection.length < 3) continue;
    
    const rightRimIdxInSection = rightSection.reduce((maxIdx, c, idx, arr) =>
      c.high > arr[maxIdx].high ? idx : maxIdx, 0);
    const rightRimPrice = rightSection[rightRimIdxInSection].high;
    const rightRimIdx = rightSearchStart + rightRimIdxInSection;
    
    // Step 4: Validate cup shape
    
    // Cup depth: should be 12-50% (tight) or 10-60% (loose)
    const cupDepthPct = ((leftPeakPrice - cupBottomPrice) / leftPeakPrice) * 100;
    const minDepth = loose ? 10 : 12;
    const maxDepth = loose ? 60 : 50;
    if (cupDepthPct < minDepth || cupDepthPct > maxDepth) continue;
    
    // Cup should be U-shaped: check that bottom is roughly centered
    const leftToBottom = cupBottomIdx - leftPeakIdx;
    const bottomToRight = rightRimIdx - cupBottomIdx;
    const symmetryRatio = Math.min(leftToBottom, bottomToRight) / Math.max(leftToBottom, bottomToRight);
    const minSymmetry = loose ? 0.25 : 0.3; // Cup doesn't need to be perfectly symmetric
    if (symmetryRatio < minSymmetry) continue;
    
    // Minimum cup width: at least 15 bars
    const cupWidth = rightRimIdx - leftPeakIdx;
    if (cupWidth < 15) continue;
    
    // Step 5: Calculate extension - how much right rim exceeds left peak
    const extensionPct = ((rightRimPrice - leftPeakPrice) / leftPeakPrice) * 100;
    
    // Filter by extension based on strictness
    // If right rim is below left peak, extension is negative (forming cup)
    // If right rim exceeds left peak by more than threshold, skip
    if (extensionPct > maxExtensionPct) continue;
    
    // Determine if this is "Cup Only" (right rim exceeded left peak)
    const cupOnly = extensionPct >= 5; // 5% or more = Cup Only
    
    // Step 6: Handle detection - look at candles after right rim
    const handleStartIdx = rightRimIdx + 1;
    const handleEndIdx = lookback - 1;
    
    if (handleEndIdx <= handleStartIdx) continue;
    
    const handleCandles = recentCandles.slice(handleStartIdx, handleEndIdx + 1);
    if (handleCandles.length < 2) continue;
    
    // Collect actual candle lows for handle visualization
    const handleLows: { time: number; price: number }[] = handleCandles.map((c, idx) => ({
      time: new Date(c.date).getTime() / 1000,
      price: c.low
    }));
    
    // Collect actual candle lows for the CUP portion (left peak to right rim)
    // This allows visualization to trace along the bar lows as support
    const cupCandles = recentCandles.slice(leftPeakIdx, rightRimIdx + 1);
    const cupLows: { time: number; price: number }[] = cupCandles.map(c => ({
      time: new Date(c.date).getTime() / 1000,
      price: c.low
    }));
    
    // Handle should be a pullback - highest low shouldn't exceed right rim too much
    const handleHighestHigh = Math.max(...handleCandles.map(c => c.high));
    const handleLowestLow = Math.min(...handleCandles.map(c => c.low));
    
    // Handle shouldn't exceed right rim significantly
    if (handleHighestHigh > rightRimPrice * 1.03) continue; // Max 3% above right rim
    
    // Handle depth: should be shallow (< 15% tight, < 20% loose from right rim)
    const handleDepthPct = ((rightRimPrice - handleLowestLow) / rightRimPrice) * 100;
    const maxHandleDepth = loose ? 20 : 15;
    if (handleDepthPct > maxHandleDepth) continue;
    
    // Current price should be recovering (in upper portion of handle)
    const currentClose = recentCandles[recentCandles.length - 1].close;
    const handleRange = rightRimPrice - handleLowestLow;
    const currentRecovery = (currentClose - handleLowestLow) / handleRange;
    if (currentRecovery < 0.3) continue; // Should be at least 30% recovered
    
    // Step 7: Calculate completion percentage
    // Based on how close current price is to breaking out above right rim
    let completionPct: number;
    if (cupOnly) {
      completionPct = 100; // Cup is complete, no handle expected
    } else if (currentClose >= rightRimPrice) {
      completionPct = 100; // Breakout achieved
    } else {
      // Calculate based on position in cup formation
      const totalRange = rightRimPrice - cupBottomPrice;
      const recovered = currentClose - cupBottomPrice;
      completionPct = totalRange > 0 
        ? Math.min(99, Math.max(0, Math.round((recovered / totalRange) * 100)))
        : 0;
      
      // If we're past the right rim time but haven't broken out, we're in handle
      if (handleCandles.length > 0) {
        // In handle phase - scale from 85-99%
        completionPct = Math.max(85, completionPct);
      }
    }
    
    // Pattern detected! Return with visualization data
    const dataStartIdx = candles.length - lookback;
    
    return {
      detected: true,
      cupOnly,
      leftPeakIdx: dataStartIdx + leftPeakIdx,
      leftPeakTime: new Date(recentCandles[leftPeakIdx].date).getTime() / 1000,
      leftPeakPrice,
      cupBottomIdx: dataStartIdx + cupBottomIdx,
      cupBottomTime: new Date(recentCandles[cupBottomIdx].date).getTime() / 1000,
      cupBottomPrice,
      rightRimIdx: dataStartIdx + rightRimIdx,
      rightRimTime: new Date(recentCandles[rightRimIdx].date).getTime() / 1000,
      rightRimPrice,
      handleStartIdx: dataStartIdx + handleStartIdx,
      handleStartTime: new Date(recentCandles[handleStartIdx].date).getTime() / 1000,
      handleEndIdx: dataStartIdx + handleEndIdx,
      handleEndTime: new Date(recentCandles[handleEndIdx].date).getTime() / 1000,
      handleLows,
      cupLows, // Bar lows for the cup portion to trace as support
      completionPct,
      extensionPct
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
