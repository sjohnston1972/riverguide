// Gauge board for phones: the paddling scale as a column of equal-height bands, each step's name
// and range written inside its band, so every label sits on its band on any screen. Now / Tomorrow
// pills point in from the left at each level, placed in proportion between its band's limits.
// Not to scale in metres: each band carries its own numbers.

import type { PaddlerStep, SectionGaugeLink } from '../shared/types.ts';
import { h } from './dom.ts';
import { formatLevel, STEP_LABEL } from './labels.ts';

interface Band {
  cls: string;
  name: string;
  range: string;
  /** Limits used to place a level inside the band (the open ends use the scale's padded edges). */
  from: number;
  to: number;
  now: boolean;
  tomorrow: boolean;
}

const LADDER: Exclude<PaddlerStep, 'empty'>[] = ['scrape', 'low', 'medium', 'high', 'very_high', 'huge'];

/** "0.38–0.40 m": short enough to fit inside a band. */
const between = (a: number, b: number) => `${a.toFixed(2)}–${formatLevel(b)}`;

/** The board for one linked gauge, or null when there is nothing to draw it against. */
export function gaugeBoard(link: SectionGaugeLink): HTMLElement | null {
  const g = link.gauge;
  const level = g.stale ? null : g.level;
  const t = level != null ? (g.outlook?.tomorrow ?? null) : null;
  const { min_level: min, max_level: max } = link;
  const tLow = g.typical_low;
  const tHigh = g.typical_high;
  const pl = link.levels;
  if (!pl && min == null && max == null && (tLow == null || tHigh == null)) return null;

  // Open-ended bands (the bottom and top ones) run to the readings' padded extremes.
  const values = [level, min, max, tLow, tHigh, t?.level, ...(pl ? Object.values(pl) : [])].filter((v): v is number => v != null && Number.isFinite(v));
  const span = Math.max(...values) - Math.min(...values);
  const lo = Math.min(...values) - Math.max(span * 0.1, 0.1);
  const hi = Math.max(...values) + Math.max(span * 0.1, 0.1);
  const inBand = (v: number | null | undefined, a: number, b: number, top: boolean) => v != null && v >= a && (top || v < b);

  const bands: Band[] = [];
  const add = (cls: string, name: string, range: string, from: number, to: number, top = false) =>
    bands.push({ cls, name, range, from, to, now: inBand(level, from, to, top), tomorrow: false });
  if (pl) {
    add('s-empty', STEP_LABEL.empty, `under ${formatLevel(pl.scrape)}`, Math.min(lo, pl.scrape), pl.scrape);
    LADDER.forEach((s, i) => {
      const from = pl[s];
      const next = LADDER[i + 1];
      const to = next ? pl[next] : Math.max(hi, from);
      add(`s-${s}`, STEP_LABEL[s], next ? between(from, to) : `from ${formatLevel(from)}`, from, to, !next);
    });
  } else if (min != null || max != null) {
    if (min != null) add('gb-low', 'Low', `under ${formatLevel(min)}`, Math.min(lo, min), min);
    const runTo = max ?? Math.max(hi, min!);
    add('gb-run', 'Runnable', min != null && max != null ? between(min, max) : min != null ? `from ${formatLevel(min)}` : `under ${formatLevel(max!)}`, min ?? Math.min(lo, max!), runTo, max == null);
    if (max != null) add('gb-high', 'Too high', `from ${formatLevel(max)}`, max, Math.max(hi, max), true);
  } else {
    // No paddling band: where the level sits against the gauge's typical range.
    add('gb-below', 'Below typical', `under ${formatLevel(tLow!)}`, Math.min(lo, tLow!), tLow!);
    add('gb-typical', 'Typical range', between(tLow!, tHigh!), tLow!, tHigh!);
    add('gb-above', 'Above typical', `from ${formatLevel(tHigh!)}`, tHigh!, Math.max(hi, tHigh!), true);
  }
  if (t) {
    const i = bands.findIndex((b, j) => inBand(t.level, b.from, b.to, j === bands.length - 1));
    if (i >= 0 && !bands[i].now) bands[i].tomorrow = true;
  }

  /** A level's position, % from the bottom: its band's slot plus how far it is through the band. */
  const pos = (v: number) => {
    const n = bands.length;
    let i = bands.findIndex((b, j) => inBand(v, b.from, b.to, j === n - 1));
    if (i < 0) i = v < bands[0].from ? 0 : n - 1;
    const b = bands[i];
    const f = Math.min(1, Math.max(0, (v - b.from) / (b.to - b.from || 1)));
    return ((i + f) / n) * 100;
  };

  const column = h(
    'div',
    { class: 'gb-bands' },
    bands.map((b) =>
      h(
        'div',
        { class: `gb-band ${b.cls}` },
        h('span', { class: 'gb-text' }, h('span', { class: 'gb-name' }, b.name), h('span', { class: 'gb-range' }, b.range)),
      ),
    ),
  );
  const pills = h(
    'div',
    { class: 'gb-pills' },
    level != null ? h('span', { class: 'gb-pill', 'data-at': String(pos(level)) }, `Now ${formatLevel(level)}`) : null,
    t ? h('span', { class: 'gb-pill gb-pill-next', 'data-at': String(pos(t.level)) }, `Tomorrow ${formatLevel(t.level)}`) : null,
  );

  const parts: string[] = [level != null ? `Current level ${formatLevel(level)}.` : 'No current reading.'];
  const cur = bands.find((b) => b.now);
  if (cur) parts.push(`${cur.name} (${cur.range}).`);
  if (t) parts.push(`Tomorrow about ${formatLevel(t.level)}, likely ${formatLevel(t.lo)} to ${formatLevel(t.hi)}.`);
  for (const b of [...bands].reverse()) parts.push(`${b.name}: ${b.range}.`);
  if (!pl && min == null && max == null) parts.push('No paddling band for this gauge yet.');

  const el = h(
    'figure',
    { class: 'gauge-board', role: 'img', 'aria-label': parts.join(' ') },
    h('div', { class: 'gb-body', 'aria-hidden': 'true' }, pills, column),
    !pl && min == null && max == null ? h('figcaption', { class: 'gb-key', 'aria-hidden': 'true' }, 'No paddling band yet') : null,
  );

  // Pills at their levels; Tomorrow moves clear of Now when the two are close.
  const place = () => {
    const H = pills.clientHeight;
    if (!H) return;
    const [now, next] = [...pills.children] as HTMLElement[];
    const centre = (p: HTMLElement) => H - (Number(p.dataset.at) / 100) * H;
    const clamp = (p: HTMLElement, y: number) => Math.min(H - p.offsetHeight / 2, Math.max(p.offsetHeight / 2, y));
    if (now) now.style.top = `${clamp(now, centre(now))}px`;
    if (next) {
      let y = centre(next);
      if (now) {
        const space = Math.max(now.offsetHeight, next.offsetHeight) + 4;
        const nowY = clamp(now, centre(now));
        if (Math.abs(y - nowY) < space) y = nowY + (y <= nowY ? -space : space);
      }
      next.style.top = `${clamp(next, y)}px`;
    }
  };
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(pills);
  requestAnimationFrame(place);
  void document.fonts?.ready.then(() => requestAnimationFrame(place));
  return el;
}
