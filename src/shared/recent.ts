// The last day of a gauge's readings, one per hour, kept by the 15-minute poll from the readings
// it already fetches (no extra SEPA requests), for the sparklines on the river list.

import type { RecentLevels } from './types.ts';

const HOUR = 3_600_000;
/** Hours kept before the newest one: a full day, plus the hour the day starts in. */
export const RECENT_HOURS = 24;

/** Stored form: [hours since the epoch, level], oldest first. */
export type StoredRecent = Array<[number, number]>;

/**
 * Merges freshly fetched readings into the stored hours. Each hour keeps one reading: the one on
 * the hour when there is one, otherwise the first fetched in that hour. Hours more than a day
 * before the newest are dropped.
 */
export function mergeRecent(stored: StoredRecent | null, points: Array<[string, number]>): StoredRecent {
  const byHour = new Map<number, number>(stored ?? []);
  for (const [t, v] of points) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) continue;
    const hour = Math.floor(ms / HOUR);
    if (ms % HOUR === 0 || !byHour.has(hour)) byHour.set(hour, Math.round(v * 1000) / 1000);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const newest = hours[hours.length - 1];
  if (newest == null) return [];
  return hours.filter((h) => h >= newest - RECENT_HOURS).map((h) => [h, byHour.get(h)!]);
}

/** The stored hours as the API sends them: a start time and one level per hour (null for a gap). */
export function toRecentLevels(stored: StoredRecent | null): RecentLevels | null {
  if (!stored?.length) return null;
  const first = stored[0][0];
  const levels: Array<number | null> = new Array(stored[stored.length - 1][0] - first + 1).fill(null);
  for (const [h, v] of stored) levels[h - first] = v;
  return { start: new Date(first * HOUR).toISOString(), levels };
}
