// Vertical "gauge board" for phones: the paddling scale drawn like a river's staff gauge, with the
// water filled to the current level, tomorrow's predicted level as a dashed line and the gauge's
// typical range as a bar beside it. Same information as the band bar (bandbar.ts), stood upright.

import type { PaddlerStep, SectionGaugeLink } from '../shared/types.ts';
import { h } from './dom.ts';
import { formatLevel, STEP_LABEL } from './labels.ts';

interface Zone {
  cls: string;
  name: string;
  range: string;
  from: number;
  to: number;
  /** The zone the level is in now, and the one it is predicted to be in tomorrow. */
  now: boolean;
  tomorrow: boolean;
}

function niceStep(range: number): number {
  for (const s of [0.1, 0.2, 0.25, 0.5, 1, 2, 5]) if (range / s <= 6) return s;
  return 10;
}

const LADDER: PaddlerStep[] = ['empty', 'scrape', 'low', 'medium', 'high', 'very_high', 'huge'];

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

  const values = [level, min, max, tLow, tHigh, t?.level, ...(pl ? Object.values(pl) : [])].filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length < 2) return null;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, 0.1);
  lo -= pad;
  hi += pad;
  if (lo < 0 && Math.min(...values) >= 0) lo = 0;
  const pct = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;

  // Zones from the bottom up: the paddler ladder, or low / runnable / high from the band.
  const zones: Zone[] = [];
  if (pl) {
    const starts = LADDER.map((s) => (s === 'empty' ? lo : pl[s as Exclude<PaddlerStep, 'empty'>]));
    LADDER.forEach((s, i) => {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : hi;
      if (to <= from) return;
      const range = s === 'empty' ? `under ${formatLevel(pl.scrape)}` : s === 'huge' ? `from ${formatLevel(pl.huge)}` : `${formatLevel(from)} to ${formatLevel(to)}`;
      zones.push({ cls: `s-${s}`, name: STEP_LABEL[s], range, from, to, now: link.step === s, tomorrow: link.step_tomorrow === s && link.step_tomorrow !== link.step });
    });
  } else if (min != null || max != null) {
    const run = { from: min ?? lo, to: max ?? hi };
    const inZone = (v: number | null | undefined, a: number, b: number) => v != null && v >= a && v < b;
    if (min != null) zones.push({ cls: 'gb-low', name: 'Low', range: `under ${formatLevel(min)}`, from: lo, to: min, now: inZone(level, lo, min), tomorrow: inZone(t?.level, lo, min) && !inZone(level, lo, min) });
    zones.push({
      cls: 'gb-run',
      name: 'Runnable',
      range: min != null && max != null ? `${formatLevel(min)} to ${formatLevel(max)}` : min != null ? `from ${formatLevel(min)}` : `under ${formatLevel(max!)}`,
      ...run,
      now: inZone(level, run.from, run.to),
      tomorrow: inZone(t?.level, run.from, run.to) && !inZone(level, run.from, run.to),
    });
    if (max != null) zones.push({ cls: 'gb-high', name: 'Too high', range: `from ${formatLevel(max)}`, from: max, to: hi, now: inZone(level, max, hi + 1), tomorrow: inZone(t?.level, max, hi + 1) && !inZone(level, max, hi + 1) });
  }

  const step = niceStep(hi - lo);
  const ticks: HTMLElement[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    if (level != null && Math.abs(pct(v) - pct(level)) < 5) continue; // the Now pill sits there
    ticks.push(h('span', { class: 'gb-tick', style: `bottom:${pct(v).toFixed(2)}%` }, `${v.toFixed(step < 0.25 ? 1 : step < 1 ? 2 : 0).replace(/\.?0+$/, '') || '0'} m`));
  }

  const board = h(
    'div',
    { class: 'gb-staff' },
    zones.map((z) => h('div', { class: `gb-zone ${z.cls}`, style: `bottom:${pct(z.from).toFixed(2)}%;height:${(pct(z.to) - pct(z.from)).toFixed(2)}%` })),
    level != null ? h('div', { class: 'gb-water', style: `height:${pct(level).toFixed(2)}%` }) : null,
    t ? h('div', { class: 'gb-tomorrow', style: `bottom:${pct(t.level).toFixed(2)}%` }) : null,
  );
  const typical =
    tLow != null && tHigh != null ? h('div', { class: 'gb-typical', style: `bottom:${pct(tLow).toFixed(2)}%;height:${(pct(tHigh) - pct(tLow)).toFixed(2)}%`, title: `Typical range ${formatLevel(tLow)} to ${formatLevel(tHigh)}` }) : null;

  const labels = h(
    'div',
    { class: 'gb-labels' },
    zones.map((z) =>
      h(
        'div',
        { class: `gb-label${z.now ? ' is-now' : ''}${z.tomorrow ? ' is-tomorrow' : ''}`, 'data-at': String((pct(z.from) + pct(z.to)) / 2) },
        h('span', { class: 'gb-name' }, z.name),
        h('span', { class: 'gb-range' }, z.range),
      ),
    ),
  );
  const marks = h(
    'div',
    { class: 'gb-marks' },
    ticks,
    level != null ? h('span', { class: 'gb-now', style: `bottom:${pct(level).toFixed(2)}%` }, `Now ${formatLevel(level)}`) : null,
  );

  const parts: string[] = [level != null ? `Current level ${formatLevel(level)}.` : 'No current reading.'];
  const cur = zones.find((z) => z.now);
  if (cur) parts.push(`${cur.name} (${cur.range}).`);
  for (const z of zones) parts.push(`${z.name}: ${z.range}.`);
  if (tLow != null && tHigh != null) parts.push(`Typical range ${formatLevel(tLow)} to ${formatLevel(tHigh)}.`);
  if (t) parts.push(`Tomorrow about ${formatLevel(t.level)}, likely ${formatLevel(t.lo)} to ${formatLevel(t.hi)}.`);
  if (!zones.length) parts.push('No paddling band for this gauge yet.');

  const el = h(
    'figure',
    { class: 'gauge-board', role: 'img', 'aria-label': parts.join(' ') },
    h('div', { class: 'gb-body', 'aria-hidden': 'true' }, marks, h('div', { class: 'gb-post' }, typical, board), labels),
    h(
      'figcaption',
      { class: 'gb-key', 'aria-hidden': 'true' },
      typical ? h('span', null, h('i', { class: 'gb-key-typical' }), 'Typical range') : null,
      t ? h('span', null, h('i', { class: 'gb-key-tomorrow' }), `Tomorrow about ${formatLevel(t.level)}`) : null,
      !zones.length ? h('span', null, 'No paddling band for this gauge yet') : null,
    ),
  );

  // Place the zone names at their zones' middles, nudged apart where zones are too thin to label.
  const place = () => {
    const H = labels.clientHeight;
    if (!H) return;
    const items = [...labels.children] as HTMLElement[];
    const gap = 18;
    let prevTop = Infinity; // px from the top, working upwards from the bottom zone
    for (const it of items) {
      const want = H - (Number(it.dataset.at) / 100) * H; // centre, px from top
      const top = Math.min(want, prevTop - gap);
      it.style.top = `${Math.max(gap / 2, top)}px`;
      prevTop = Math.max(gap / 2, top);
    }
  };
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(labels);
  requestAnimationFrame(place);
  return el;
}
