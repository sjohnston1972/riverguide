// The river list's sparkline: the headline gauge's last day, a dotted line at the latest reading,
// then the outlook on to tomorrow (dashed, inside its likely range), over the section's levels:
// runnable, too low (amber) and too high (the High colour), with a thin line at each threshold.
// The curve and range are drawn the way the level graph draws them (rainlayer.ts).

import type { LevelPoint, SectionSummary } from '../shared/types.ts';
import { DAY, HOUR, outlookCurve, recentSlope, ukMidnight } from './rainlayer.ts';

/** Drawing units; CSS sets the size on the page (smaller on phones), and strokes don't scale. */
export const SPARK_W = 88;
export const SPARK_H = 24;
const PAD = 2;
/** A level range narrower than this is drawn as this, so a steady river looks steady. */
const MIN_SPAN_M = 0.15;
/** Readings further apart than this are left unjoined. */
const GAP_MS = 2 * HOUR;

export type SparkInput = Pick<SectionSummary, 'recent' | 'level' | 'level_at' | 'min_level' | 'max_level' | 'tomorrow'>;

export interface SparkGeometry {
  /** The readings (SVG path data; a gap starts a new piece). */
  line: string;
  /** The outlook line and its range, empty without an outlook. */
  outlook: string;
  range: string;
  /** The latest reading: where the dotted line stands. */
  nowX: number;
  nowY: number;
  /** The runnable, too-low and too-high zones as [top, bottom], clipped to the box; null when off the chart or unset. */
  zones: Record<'runnable' | 'low' | 'high', [number, number] | null>;
  /** Where the thresholds cross the box (y), for those on the chart. */
  edges: number[];
}

const f = (n: number) => Math.round(n * 10) / 10;

/**
 * Where everything goes. The time axis runs from a day before the latest reading to midday
 * tomorrow (UK), where the level graph also puts tomorrow's predicted peak, so "now" lines up
 * down the list whether or not a river has an outlook.
 */
export function sparkGeometry(s: SparkInput, w = SPARK_W, h = SPARK_H): SparkGeometry | null {
  if (!s.recent || s.level == null || !s.level_at) return null;
  const t0 = Date.parse(s.level_at);
  if (!Number.isFinite(t0)) return null;
  const from = t0 - DAY;
  const start = Date.parse(s.recent.start);
  const past: Array<[number, number]> = [];
  s.recent.levels.forEach((v, i) => {
    const t = start + i * HOUR;
    if (v != null && t >= from && t < t0) past.push([t, v]);
  });
  past.push([t0, s.level]);
  if (past.length < 2) return null;

  const tomorrow = ukMidnight(t0) + DAY + 12 * HOUR;
  let mid: Array<[number, number]> = [];
  let up: number[] = [];
  let down: number[] = [];
  if (s.tomorrow) {
    const r = s.tomorrow;
    const slope = recentSlope(past.map(([t, v]): LevelPoint => ({ t: new Date(t).toISOString(), v })));
    mid = outlookCurve([[t0, s.level], [tomorrow, r.level]], slope, 24);
    // How far above and below the line the range reaches, opening from nothing at the latest reading.
    const spread = (by: number) => outlookCurve([[t0, 0], [tomorrow, Math.max(0, by)]], 0, 24).map(([, d]) => Math.max(0, d));
    up = spread(r.hi - r.level);
    down = spread(r.level - r.lo);
  }

  const values = [...past.map(([, v]) => v), ...mid.map(([, v], i) => v + up[i]), ...mid.map(([, v], i) => v - down[i])];
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const span = Math.max(hi0 - lo0, MIN_SPAN_M) * 1.15;
  const lo = (hi0 + lo0) / 2 - span / 2;
  const hi = lo + span;
  const X = (t: number) => PAD + ((t - from) / (tomorrow - from)) * (w - 2 * PAD);
  const Y = (v: number) => PAD + ((hi - v) / span) * (h - 2 * PAD);
  const pt = (t: number, v: number) => `${f(X(t))},${f(Y(v))}`;

  let line = '';
  past.forEach(([t, v], i) => {
    line += `${i > 0 && t - past[i - 1][0] <= GAP_MS ? 'L' : 'M'}${pt(t, v)}`;
  });
  const outlook = mid.length ? `M${mid.map(([t, v]) => pt(t, v)).join('L')}` : '';
  const range = mid.length
    ? `M${mid.map(([t, v], i) => pt(t, v + up[i])).join('L')}L${mid
        .map(([t, v], i) => pt(t, v - down[i]))
        .reverse()
        .join('L')}Z`
    : '';

  // A section with no thresholds gets no zones; one with only a minimum (or maximum) is runnable all the way up (or down).
  const zones: SparkGeometry['zones'] = { runnable: null, low: null, high: null };
  const edges: number[] = [];
  if (s.min_level != null || s.max_level != null) {
    const clip = (top: number, bottom: number): [number, number] | null => {
      const t = Math.max(0, top);
      const b = Math.min(h, bottom);
      return b > t ? [f(t), f(b)] : null;
    };
    const yMax = s.max_level != null ? Y(s.max_level) : -Infinity;
    const yMin = s.min_level != null ? Y(s.min_level) : Infinity;
    zones.runnable = clip(yMax, yMin);
    if (s.min_level != null) zones.low = clip(yMin, h);
    if (s.max_level != null) zones.high = clip(0, yMax);
    for (const y of [yMax, yMin]) if (y > 0 && y < h) edges.push(f(y));
  }
  return { line, outlook, range, nowX: f(X(t0)), nowY: f(Y(s.level)), zones, edges };
}

const SVG = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** The sparkline for a list row, or null when there is nothing current to draw. Decorative: the level beside it says it. */
export function sparkline(s: SparkInput & Pick<SectionSummary, 'stale'>): SVGSVGElement | null {
  if (s.stale) return null;
  const g = sparkGeometry(s);
  if (!g) return null;
  const svg = el('svg', { class: 'spark', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }) as SVGSVGElement;
  for (const zone of ['runnable', 'low', 'high'] as const) {
    const z = g.zones[zone];
    if (z) svg.append(el('rect', { class: `spark-zone spark-${zone}`, x: 0, y: z[0], width: SPARK_W, height: f(z[1] - z[0]) }));
  }
  for (const y of g.edges) svg.append(el('path', { class: 'spark-edge', d: `M0,${y}H${SPARK_W}` }));
  if (g.range) svg.append(el('path', { class: 'spark-range', d: g.range }));
  svg.append(el('path', { class: 'spark-now', d: `M${g.nowX},0V${SPARK_H}` }));
  if (g.outlook) svg.append(el('path', { class: 'spark-outlook', d: g.outlook }));
  svg.append(el('path', { class: 'spark-line', d: g.line }));
  // A zero-length line with round caps: a dot that stays round when the box is squashed.
  svg.append(el('path', { class: 'spark-dot', d: `M${g.nowX},${g.nowY}h0` }));
  return svg;
}
