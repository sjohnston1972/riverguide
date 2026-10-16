// The river list's sparkline: the headline gauge's last day, a dotted line at the latest reading,
// then the outlook on to tomorrow (dashed, inside its likely range), over the runnable band.
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
  /** The runnable band's top and bottom, clipped to the box; null when it is off the chart or unset. */
  band: [number, number] | null;
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

  let band: [number, number] | null = null;
  if (s.min_level != null || s.max_level != null) {
    const top = Math.max(0, s.max_level != null ? Y(s.max_level) : 0);
    const bottom = Math.min(h, s.min_level != null ? Y(s.min_level) : h);
    if (bottom > top) band = [f(top), f(bottom)];
  }
  return { line, outlook, range, nowX: f(X(t0)), nowY: f(Y(s.level)), band };
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
  if (g.band) svg.append(el('rect', { class: 'spark-band', x: 0, y: g.band[0], width: SPARK_W, height: f(g.band[1] - g.band[0]) }));
  if (g.range) svg.append(el('path', { class: 'spark-range', d: g.range }));
  svg.append(el('path', { class: 'spark-now', d: `M${g.nowX},0V${SPARK_H}` }));
  if (g.outlook) svg.append(el('path', { class: 'spark-outlook', d: g.outlook }));
  svg.append(el('path', { class: 'spark-line', d: g.line }));
  // A zero-length line with round caps: a dot that stays round when the box is squashed.
  svg.append(el('path', { class: 'spark-dot', d: `M${g.nowX},${g.nowY}h0` }));
  return svg;
}
