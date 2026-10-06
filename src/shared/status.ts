import type { Confidence, Relation, SectionStatus, Trend, TypicalStatus } from './types.ts';

/** A reading older than this is treated as unknown rather than current. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Change over an hour (metres) below which a gauge counts as steady. */
const TREND_THRESHOLD_M = 0.01;

export function isStale(levelAt: string | null, now = Date.now()): boolean {
  if (!levelAt) return true;
  return now - Date.parse(levelAt) > STALE_AFTER_MS;
}

export function trendFrom(latest: number | null, hourAgo: number | null): Trend {
  if (latest == null || hourAgo == null) return 'unknown';
  const d = latest - hourAgo;
  if (d > TREND_THRESHOLD_M) return 'rising';
  if (d < -TREND_THRESHOLD_M) return 'falling';
  return 'steady';
}

export function typicalStatus(level: number | null, low: number | null, high: number | null): TypicalStatus {
  if (level == null || low == null || high == null) return 'unknown';
  if (level < low) return 'below';
  if (level > high) return 'above';
  return 'typical';
}

export function sectionStatus(level: number | null, stale: boolean, min: number | null, max: number | null): SectionStatus {
  if (level == null || stale || (min == null && max == null)) return 'unknown';
  if (min != null && level < min) return 'low';
  if (max != null && level > max) return 'high';
  return 'runnable';
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const RELATION_RANK: Record<Relation, number> = { 'on-section': 0, upstream: 1, downstream: 1, proxy: 2 };

/** Sort key for choosing a section's headline gauge: manual, then community, then confidence and proximity of relation. */
export function linkRank(l: { basis: string; confidence: Confidence; relation: Relation }): number {
  const basis = l.basis === 'manual' ? 0 : l.basis === 'community' ? 50 : 100;
  return basis + CONFIDENCE_RANK[l.confidence] * 10 + RELATION_RANK[l.relation];
}

/**
 * Converts thresholds expressed relative to a gauge's typical range
 * (0 = median annual minimum, 1 = median annual maximum) into metres.
 */
export function relativeToAbsolute(fraction: number | null, low: number | null, high: number | null): number | null {
  if (fraction == null || low == null || high == null) return null;
  return Math.round((low + fraction * (high - low)) * 1000) / 1000;
}
