import type { Confidence, PaddlerLevels, PaddlerStep, Relation, SectionStatus, Trend, TypicalStatus } from './types.ts';

/** A reading older than this is treated as unknown rather than current. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Change over an hour (metres) below which a gauge counts as steady. */
const TREND_THRESHOLD_M = 0.01;

export function isStale(levelAt: string | null, now = Date.now()): boolean {
  if (!levelAt) return true;
  const t = Date.parse(levelAt);
  return !(now - t <= STALE_AFTER_MS); // an unparseable time (NaN) counts as stale
}

/** How long SEPA's rising/falling flag counts as current, relative to the level reading. */
const SEPA_TREND_MAX_LAG_MS = 60 * 60_000;

/**
 * The trend shown for a gauge: SEPA's own rising/falling indicator (the one behind
 * the arrows on SEPA's site) while it is current, otherwise the change over the last hour.
 */
export function gaugeTrend(
  latest: number | null,
  hourAgo: number | null,
  levelAt: string | null,
  sepaFlag: number | null,
  sepaAt: string | null,
): Trend {
  if (sepaFlag != null && sepaAt && levelAt && Math.abs(Date.parse(levelAt) - Date.parse(sepaAt)) <= SEPA_TREND_MAX_LAG_MS) {
    return sepaFlag > 0 ? 'rising' : sepaFlag < 0 ? 'falling' : 'steady';
  }
  return trendFrom(latest, hourAgo);
}

/** Level change over about a day, when the reading a day ago is 22-26 hours older than the latest. */
export function dayChange(level: number | null, levelAt: string | null, dayAgo: number | null, dayAgoAt: string | null): number | null {
  if (level == null || dayAgo == null || !levelAt || !dayAgoAt) return null;
  const hours = (Date.parse(levelAt) - Date.parse(dayAgoAt)) / 3_600_000;
  return hours >= 22 && hours <= 26 ? level - dayAgo : null;
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

/** Sort key for choosing a section's headline gauge: manual, community, paddler-set, then confidence and proximity of relation. */
export function linkRank(l: { basis: string; confidence: Confidence; relation: Relation }): number {
  const basis = l.basis === 'manual' ? 0 : l.basis === 'community' ? 50 : l.basis === 'paddler' ? 70 : 100;
  return basis + CONFIDENCE_RANK[l.confidence] * 10 + RELATION_RANK[l.relation];
}

/** Where a level sits on a paddler scale (each threshold is where that step starts). */
export function paddlerStep(level: number | null, stale: boolean, levels: PaddlerLevels | null): PaddlerStep | null {
  if (level == null || stale || !levels) return null;
  const steps: Array<[PaddlerStep, number]> = [
    ['huge', levels.huge],
    ['very_high', levels.very_high],
    ['high', levels.high],
    ['medium', levels.medium],
    ['low', levels.low],
    ['scrape', levels.scrape],
  ];
  for (const [step, from] of steps) if (level >= from) return step;
  return 'empty';
}

/** Today's date in the UK as YYYY-MM-DD. */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Converts thresholds expressed relative to a gauge's typical range
 * (0 = median annual minimum, 1 = median annual maximum) into metres.
 */
export function relativeToAbsolute(fraction: number | null, low: number | null, high: number | null): number | null {
  if (fraction == null || low == null || high == null) return null;
  return Math.round((low + fraction * (high - low)) * 1000) / 1000;
}
