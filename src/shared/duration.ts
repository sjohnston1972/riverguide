// Level-duration curves: how often a gauge reaches a given level.
//
// Built from SEPA daily maximum levels over several years. A point
// [pct, level] means "the daily maximum reached `level` on `pct`% of days".
// Daily maxima (not means) are used because spate runs peak for hours, not
// all day: "reached on 10% of days" is a fair description of a spate creek.

export type DurationCurve = Array<[pct: number, level: number]>;

/** Exceedance percentages stored per gauge, most frequent (lowest level) first. */
export const CURVE_PCTS = [99, 95, 90, 80, 70, 60, 50, 40, 30, 20, 15, 10, 7, 5, 3, 2, 1, 0.5];

/** Minimum days of data for a usable curve (about 10 months). */
export const MIN_DAYS = 300;

export function buildCurve(dailyMax: number[]): DurationCurve | null {
  const v = dailyMax.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < MIN_DAYS) return null;
  const quantile = (q: number) => {
    const pos = q * (v.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  // Reached on pct% of days  <=>  the (100 - pct)th percentile of daily maxima.
  return CURVE_PCTS.map((pct) => [pct, Math.round(quantile(1 - pct / 100) * 1000) / 1000]);
}

/** Level reached on `pct`% of days, interpolated along the curve (clamped to its ends). */
export function levelForPct(curve: DurationCurve, pct: number): number {
  if (pct >= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [p1, l1] = curve[i];
    if (pct >= p1) {
      const [p0, l0] = curve[i - 1];
      return Math.round((l1 + ((pct - p1) / (p0 - p1)) * (l0 - l1)) * 1000) / 1000;
    }
  }
  return curve[curve.length - 1][1];
}

/** Percentage of days on which `level` is reached (0.5–99, clamped at the curve's ends). */
export function pctForLevel(curve: DurationCurve, level: number): number {
  if (level <= curve[0][1]) return curve[0][0];
  for (let i = 1; i < curve.length; i++) {
    const [p1, l1] = curve[i];
    if (level <= l1) {
      const [p0, l0] = curve[i - 1];
      if (l1 === l0) return p1;
      return Math.round((p0 - ((level - l0) / (l1 - l0)) * (p0 - p1)) * 10) / 10;
    }
  }
  return curve[curve.length - 1][0];
}

/** A short description of a curve for prompts: level reached on common percentages of days. */
export function describeCurve(curve: DurationCurve): string {
  const pick = [90, 50, 30, 20, 10, 5, 2];
  return pick.map((p) => `${p}%: ${levelForPct(curve, p).toFixed(2)} m`).join(', ');
}
