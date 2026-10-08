// Community level reports -> paddling thresholds.
//
// Each report says how a section was ("too low" … "too high") at a known gauge
// level. Once enough independent reports exist, the band is set where the
// reports change from too low to runnable (and runnable to too high). A side
// with no evidence keeps the estimated threshold, and one-sided evidence can
// only move a threshold in the direction it supports, and only as far as at
// least two people agree (so one mistaken report can't drag it).

export const VERDICTS = ['too_low', 'scrapy', 'good', 'pushy', 'too_high'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
  too_low: 'Too low',
  scrapy: 'Scrapy',
  good: 'Good',
  pushy: 'Pushy',
  too_high: 'Too high',
};

const RUNNABLE: ReadonlySet<Verdict> = new Set(['scrapy', 'good', 'pushy']);

/** Minimum evidence before community reports set a band. */
export const BAND_RULES = { reports: 5, people: 3, days: 2 } as const;

export interface CalibrationPoint {
  level: number;
  verdict: Verdict;
  /** 1 + "same for me" votes from other people (capped by the Worker). */
  weight: number;
  /** Stable pseudonymous id for distinct-people counting (hashed IP). */
  person: string;
  /** YYYY-MM-DD the run happened. */
  day: string;
}

export interface Evidence {
  reports: number;
  people: number;
  days: number;
}

export interface DerivedBand extends Evidence {
  min_level: number | null;
  max_level: number | null;
  confidence: 'high' | 'medium';
}

export function evidenceOf(points: CalibrationPoint[]): Evidence {
  return {
    reports: points.length,
    people: new Set(points.map((p) => p.person)).size,
    days: new Set(points.map((p) => p.day)).size,
  };
}

export function hasEnoughEvidence(e: Evidence): boolean {
  return e.reports >= BAND_RULES.reports && e.people >= BAND_RULES.people && e.days >= BAND_RULES.days;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The most extreme level that at least two different people support: walk the reports from
 * the most extreme inwards and stop at the second distinct person. Null with only one person.
 */
export function secondPersonLevel(points: CalibrationPoint[], extreme: 'lowest' | 'highest'): number | null {
  const sorted = [...points].sort((a, b) => (extreme === 'lowest' ? a.level - b.level : b.level - a.level));
  const people = new Set<string>();
  for (const p of sorted) {
    people.add(p.person);
    if (people.size === 2) return p.level;
  }
  return null;
}

/**
 * Best boundary between points that should sit below it and points that should
 * sit above it: the threshold with the least (weighted) disagreement. Ties take
 * the middle of the best range, so a clean split lands halfway between the groups.
 */
export function splitLevel(below: CalibrationPoint[], above: CalibrationPoint[]): number {
  const levels = [...new Set([...below, ...above].map((p) => p.level))].sort((a, b) => a - b);
  const candidates = [levels[0] - 0.01];
  for (let i = 1; i < levels.length; i++) candidates.push((levels[i - 1] + levels[i]) / 2);
  candidates.push(levels[levels.length - 1] + 0.01);

  const cost = (t: number) =>
    below.reduce((s, p) => s + (p.level >= t ? p.weight : 0), 0) + above.reduce((s, p) => s + (p.level < t ? p.weight : 0), 0);
  const costs = candidates.map(cost);
  const best = Math.min(...costs);
  const tied = candidates.filter((_, i) => costs[i] === best);
  return round((tied[0] + tied[tied.length - 1]) / 2);
}

export function deriveBand(
  points: CalibrationPoint[],
  estimate: { min: number | null; max: number | null },
): DerivedBand | null {
  const evidence = evidenceOf(points);
  if (!hasEnoughEvidence(evidence)) return null;

  const tooLow = points.filter((p) => p.verdict === 'too_low');
  const tooHigh = points.filter((p) => p.verdict === 'too_high');
  const run = points.filter((p) => RUNNABLE.has(p.verdict));

  // Both sides reported: split between them (weighted, tolerant of an outlier). One side only:
  // move the estimate only as far as two people agree.
  let min = estimate.min;
  if (tooLow.length && run.length) min = splitLevel(tooLow, run);
  else if (run.length && min != null) {
    const runLow = secondPersonLevel(run, 'lowest'); // runnable lower than estimated
    if (runLow != null) min = Math.min(min, runLow);
  } else if (tooLow.length) {
    const lowHigh = secondPersonLevel(tooLow, 'highest'); // still too low above the estimate
    if (lowHigh != null) min = round(Math.max(min ?? -Infinity, lowHigh + 0.01));
  }

  let max = estimate.max;
  if (tooHigh.length && run.length) max = splitLevel(run, tooHigh);
  else if (run.length && max != null) {
    const runHigh = secondPersonLevel(run, 'highest'); // runnable higher than estimated
    if (runHigh != null) max = Math.max(max, runHigh);
  } else if (tooHigh.length) {
    const highLow = secondPersonLevel(tooHigh, 'lowest'); // already too high below the estimate
    if (highLow != null) max = round(Math.min(max ?? Infinity, highLow - 0.01));
  }

  // No threshold at all says nothing; reports that cross over give no usable band.
  if (min == null && max == null) return null;
  if (min != null && max != null && min >= max) return null;

  return {
    ...evidence,
    min_level: min,
    max_level: max,
    confidence: evidence.reports >= 12 && evidence.people >= 6 ? 'high' : 'medium',
  };
}

/** Gauge level nearest to time `t` (ms), if a reading exists within `maxGapMs`. */
export function levelAt(points: Array<{ t: string; v: number }>, t: number, maxGapMs = 2 * 3_600_000): number | null {
  let best: { gap: number; v: number } | null = null;
  for (const p of points) {
    const gap = Math.abs(Date.parse(p.t) - t);
    if (gap <= maxGapMs && (!best || gap < best.gap)) best = { gap, v: p.v };
  }
  return best ? best.v : null;
}
