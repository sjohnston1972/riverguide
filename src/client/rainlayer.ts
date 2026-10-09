// Rain and outlook layers for the level graph: hourly rain grouped into bars, each day's total,
// and the outlook curve (a smooth spline from the latest reading through the predicted levels).

import type { LevelPoint, RainSeries } from "../shared/types.ts";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const ukClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** UK midnight at or before t (ms). */
export function ukMidnight(t: number): number {
  const parts = ukClock.formatToParts(t);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return t - (t % 60_000) - part("hour") * HOUR - part("minute") * 60_000;
}

/** Bar width for a history period: hourly over 2 days, 6-hourly over a week, daily beyond. */
export const barSize = (days: number): number =>
  days <= 2 ? HOUR : days <= 7 ? 6 * HOUR : DAY;

/** The rain that fills a bar's height, so drizzle never looks like a downpour. */
export const barScaleFloor = (size: number): number =>
  size <= HOUR ? 2 : size <= 6 * HOUR ? 6 : 15;

export interface RainBar {
  /** Start of the bar (ms) and its width. */
  t: number;
  size: number;
  /** Rain that has fallen, and rain still forecast, in this bar. */
  mm: number;
  forecastMm: number;
}

/** Hourly rain from `from` to `to` (ms) grouped into bars of `size`, aligned to UK midnight. */
export function rainBars(
  rain: RainSeries,
  from: number,
  to: number,
  size: number,
  now: number,
): RainBar[] {
  const start = Date.parse(rain.start);
  const bars = new Map<number, RainBar>();
  rain.mm.forEach((mm, i) => {
    const t = start + i * HOUR;
    if (t + HOUR <= from || t >= to || !(mm > 0)) return;
    const midnight = ukMidnight(t);
    const at =
      size <= HOUR ? t : midnight + Math.floor((t - midnight) / size) * size;
    const bar = bars.get(at) ?? { t: at, size, mm: 0, forecastMm: 0 };
    if (t + HOUR > now) bar.forecastMm += mm;
    else bar.mm += mm;
    bars.set(at, bar);
  });
  return [...bars.values()].sort((a, b) => a.t - b.t);
}

export interface DayTotal {
  /** UK midnight that starts the day (ms). */
  start: number;
  mm: number;
  forecastMm: number;
}

/** Rain per UK day from `from` to `to`, split into fallen and forecast. */
export function dayTotals(
  rain: RainSeries,
  from: number,
  to: number,
  now: number,
): DayTotal[] {
  return rainBars(rain, from, to, DAY, now).map((b) => ({
    start: b.t,
    mm: b.mm,
    forecastMm: b.forecastMm,
  }));
}

/** Rain in the whole hours from `from` to `to` (ms). */
export function rainBetween(
  rain: RainSeries,
  from: number,
  to: number,
): number {
  const start = Date.parse(rain.start);
  return rain.mm.reduce(
    (sum, mm, i) =>
      start + i * HOUR >= from && start + (i + 1) * HOUR <= to ? sum + mm : sum,
    0,
  );
}

/** The river's rate of change over its last few hours, in metres per hour. */
export function recentSlope(points: LevelPoint[], hours = 3): number {
  if (points.length < 2) return 0;
  const last = points[points.length - 1];
  const tLast = Date.parse(last.t);
  let first = points[points.length - 2];
  for (
    let i = points.length - 2;
    i >= 0 && Date.parse(points[i].t) >= tLast - hours * HOUR;
    i--
  )
    first = points[i];
  const dt = (tLast - Date.parse(first.t)) / HOUR;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

/**
 * Points along a cubic spline through `knots` ([ms, m]) that is smooth in both slope and curvature
 * (C2). It leaves the first knot at `slope` (m per hour), so it carries on from the river's current
 * rise or fall, and it runs straight out of the last knot.
 */
export function outlookCurve(
  knots: Array<[number, number]>,
  slope: number,
  steps = 48,
): Array<[number, number]> {
  const n = knots.length;
  if (n < 2) return knots.slice();
  const x = knots.map(([t]) => t / HOUR);
  const y = knots.map(([, v]) => v);
  const hs = x.slice(1).map((xi, i) => xi - x[i]);
  const d = hs.map((hi, i) => (y[i + 1] - y[i]) / hi);
  // Second derivatives M: clamped start, natural end (M[n-1] = 0); a tridiagonal system.
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(1);
  const c = new Array<number>(n).fill(0);
  const r = new Array<number>(n).fill(0);
  b[0] = 2 * hs[0];
  c[0] = hs[0];
  r[0] = 6 * (d[0] - slope);
  for (let i = 1; i < n - 1; i++) {
    a[i] = hs[i - 1];
    b[i] = 2 * (hs[i - 1] + hs[i]);
    c[i] = hs[i];
    r[i] = 6 * (d[i] - d[i - 1]);
  }
  for (let i = 1; i < n; i++) {
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    r[i] -= w * r[i - 1];
  }
  const M = new Array<number>(n).fill(0);
  M[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) M[i] = (r[i] - c[i] * M[i + 1]) / b[i];

  const out: Array<[number, number]> = [];
  for (let i = 0; i < n - 1; i++) {
    const hi = hs[i];
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const xi = x[i] + (k / steps) * hi;
      const A = x[i + 1] - xi;
      const B = xi - x[i];
      const v =
        (M[i] * A ** 3 + M[i + 1] * B ** 3) / (6 * hi) +
        (y[i] / hi - (M[i] * hi) / 6) * A +
        (y[i + 1] / hi - (M[i + 1] * hi) / 6) * B;
      out.push([xi * HOUR, v]);
    }
  }
  return out;
}
