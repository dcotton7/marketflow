/** Flood detectors fire many repeats per name per day. Clock the first episode only. */
export const FLOOD_TRACK_ONCE_PER_DAY = [
  "lod_bounce",
  "hod_fade",
  "ma_proximity",
  "gap",
  "volume_spike",
] as const;

export type FloodTrackOncePerDay = (typeof FLOOD_TRACK_ONCE_PER_DAY)[number];

export function isFloodTrackOncePerDay(signalType: string): boolean {
  return (FLOOD_TRACK_ONCE_PER_DAY as readonly string[]).includes(signalType);
}

/**
 * Among prints of the same type + subject + ET day, only the lowest id is clocked
 * for flood types. Non-flood types always return true. Repeats are not deleted.
 */
export function shouldClockDiscoveryEpisode(
  signalType: string,
  rowId: number,
  sameDaySameNameIds: readonly number[]
): boolean {
  if (!isFloodTrackOncePerDay(signalType)) return true;
  if (sameDaySameNameIds.length === 0) return true;
  return rowId === Math.min(...sameDaySameNameIds);
}
