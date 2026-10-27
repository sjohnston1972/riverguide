// Learning from checked outlooks: each morning the Worker saves every gauge's
// prediction (worker/learning.ts), and once SEPA publishes the daily peaks it
// compares them with what the river actually did. From those checked days each
// gauge can learn, for tomorrow and the day after separately:
//   - a bias: the model's typical miss (median error), added to its prediction.
//     Catches gauges the grid consistently over- or under-predicts, including
//     the gap between the rain forecast it is fed live and the rain that fell,
//     which the offline tests (fitted on actual rain) could not see.
//   - a range scale: stretches or shrinks the likely range so about 80% of
//     peaks land inside it, as the range claims.
// Each correction is used only if it would have helped, tested prequentially:
// for every checked day, the correction is learned from the days before it
// only, then scored on that day. It must beat the uncorrected model by MARGIN
// over at least MIN_EVAL such days (after MIN_TRAIN days to learn from).
// A gauge whose live predictions do worse than "the peak stays at the level
// now" is demoted to a direction only, until it clearly recovers.

export interface CheckedDay {
  /** Level when the prediction was made. */
  now: number;
  /** Raw model prediction (before any learned correction) and its likely range. */
  pred: number;
  lo: number;
  hi: number;
  /** The daily peak SEPA recorded for that day. */
  actual: number;
}

export interface HorizonCorrection {
  /** Metres added to the prediction (0 = none). */
  bias: number;
  /** Multiplies the distance from the prediction to each end of the range (1 = none). */
  scale: number;
}

export interface LearnedOutlook {
  /** Checked days used for tomorrow (the most recent WINDOW). */
  days: number;
  tomorrow: HorizonCorrection;
  day_after: HorizonCorrection;
  /** Live skill for tomorrow (with corrections) against "stays at the level now"; null until MIN_SKILL_DAYS. */
  skill: number | null;
  /** Show a direction only: live predictions have been worse than no change. */
  demoted: boolean;
  at: string;
}

/** Most recent checked days learned from (about a season). */
export const WINDOW = 90;
/** Days a correction is learned from before it is first scored. */
export const MIN_TRAIN = 20;
/** Scored days needed before a correction can be used. */
export const MIN_EVAL = 10;
/** Weight (in days) pulling a correction back to none: few days, small correction. */
const PRIOR = 10;
/** A correction must cut the error (or interval score) by this fraction to be used. */
const MARGIN = 0.03;
/** The range is a 10th-90th percentile range. */
const COVERAGE = 0.8;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;
/** Ranges narrower than this (m) each side are treated as this, so a zero-width side can't divide by zero. */
const MIN_WIDTH = 0.005;
export const MIN_SKILL_DAYS = MIN_TRAIN + MIN_EVAL;
/** Demoted below this live skill; a demoted gauge needs PROMOTE_AT to get its numbers back. */
const DEMOTE_BELOW = 0;
const PROMOTE_AT = 0.05;

export const NO_CORRECTION: HorizonCorrection = { bias: 0, scale: 1 };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const i = Math.floor(pos);
  return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (pos - i) : s[i];
}

/** Median error, shrunk towards 0 when there are few days. */
function shrunkBias(errors: number[]): number {
  if (!errors.length) return 0;
  return (quantile(errors, 0.5) * errors.length) / (errors.length + PRIOR);
}

/** The scale that would put COVERAGE of these misses inside the range, shrunk towards 1. */
function shrunkScale(z: number[]): number {
  if (!z.length) return 1;
  const s = (quantile(z, COVERAGE) * z.length + PRIOR) / (z.length + PRIOR);
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

/** How far outside (>1) or inside (<1) its range a peak landed, in units of that side's width. */
function rangePosition(d: CheckedDay, centre: number): number {
  return d.actual >= centre ? (d.actual - centre) / Math.max(MIN_WIDTH, d.hi - d.pred) : (centre - d.actual) / Math.max(MIN_WIDTH, d.pred - d.lo);
}

/** Interval score for a central range: its width plus a penalty for each miss (lower is better). */
export function intervalScore(lo: number, hi: number, actual: number, alpha = 1 - COVERAGE): number {
  return hi - lo + (2 / alpha) * Math.max(0, lo - actual) + (2 / alpha) * Math.max(0, actual - hi);
}

interface Prequential {
  correction: HorizonCorrection;
  /** The prediction as it would have been shown each day (bias learned from earlier days, if used). */
  centres: number[];
}

/** Learn one horizon's correction from checked days, oldest first. */
export function learnHorizon(all: CheckedDay[]): Prequential {
  const days = all.slice(-WINDOW - MIN_TRAIN);
  const errors = days.map((d) => d.actual - d.pred);
  // Bias learned from the days before each day.
  const biasBefore = days.map((_, i) => shrunkBias(errors.slice(Math.max(0, i - WINDOW), i)));
  let rawErr = 0;
  let biasErr = 0;
  let scored = 0;
  for (let i = MIN_TRAIN; i < days.length; i++) {
    rawErr += Math.abs(errors[i]);
    biasErr += Math.abs(errors[i] - biasBefore[i]);
    scored++;
  }
  const useBias = scored >= MIN_EVAL && biasErr < rawErr * (1 - MARGIN);
  const centres = days.map((d, i) => d.pred + (useBias ? biasBefore[i] : 0));

  const z = days.map((d, i) => rangePosition(d, centres[i]));
  let rawScore = 0;
  let scaledScore = 0;
  for (let i = MIN_TRAIN; i < days.length; i++) {
    const d = days[i];
    const c = centres[i];
    const s = shrunkScale(z.slice(Math.max(0, i - WINDOW), i));
    rawScore += intervalScore(c - (d.pred - d.lo), c + (d.hi - d.pred), d.actual);
    scaledScore += intervalScore(c - s * (d.pred - d.lo), c + s * (d.hi - d.pred), d.actual);
  }
  const useScale = scored >= MIN_EVAL && scaledScore < rawScore * (1 - MARGIN);

  const recent = Math.max(0, days.length - WINDOW);
  return {
    correction: {
      bias: useBias ? r3(shrunkBias(errors.slice(recent))) : 0,
      scale: useScale ? Math.round(shrunkScale(z.slice(recent)) * 100) / 100 : 1,
    },
    centres: centres.slice(recent),
  };
}

/**
 * Corrections for one gauge from its checked days (oldest first; the day after has its own list,
 * as it is checked a day later). `wasDemoted`: the gauge's current state, for hysteresis.
 */
export function learnOutlook(tomorrow: CheckedDay[], dayAfter: CheckedDay[], wasDemoted: boolean, now = new Date()): LearnedOutlook {
  const t = learnHorizon(tomorrow);
  const recent = tomorrow.slice(-t.centres.length);
  let skill: number | null = null;
  if (recent.length >= MIN_SKILL_DAYS) {
    const model = recent.reduce((s, d, i) => s + Math.abs(d.actual - t.centres[i]), 0);
    const persistence = recent.reduce((s, d) => s + Math.abs(d.actual - d.now), 0);
    if (persistence > 0) skill = Math.round((1 - model / persistence) * 1000) / 1000;
  }
  const demoted = skill == null ? wasDemoted : skill < (wasDemoted ? PROMOTE_AT : DEMOTE_BELOW);
  return {
    days: recent.length,
    tomorrow: t.correction,
    day_after: learnHorizon(dayAfter).correction,
    skill,
    demoted,
    at: now.toISOString(),
  };
}

export interface Range {
  level: number;
  lo: number;
  hi: number;
}

/** Apply a learned correction to a predicted range, never below `floor`. */
export function correctRange(p: Range, c: HorizonCorrection, floor: number): Range {
  if (c.bias === 0 && c.scale === 1) return p;
  const level = p.level + c.bias;
  const f = (v: number) => r3(Math.max(floor, v));
  return { level: f(level), lo: f(level - c.scale * (p.level - p.lo)), hi: f(level + c.scale * (p.hi - p.level)) };
}
