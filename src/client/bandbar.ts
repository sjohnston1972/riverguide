// Horizontal "gauge board": current level against the paddling band and the
// gauge's typical range.

import type { PaddlerLevels, PaddlerStep, SectionGaugeLink } from '../shared/types.ts';
import { h } from './dom.ts';
import { formatLevel, STEP_LABEL, weekdayAfter } from './labels.ts';

function niceStep(range: number): number {
  for (const s of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]) if (range / s <= 5) return s;
  return 10;
}


export function bandBar(link: SectionGaugeLink): HTMLElement | null {
  const g = link.gauge;
  const level = g.stale ? null : g.level;
  const { min_level: min, max_level: max } = link;
  const tLow = g.typical_low;
  const tHigh = g.typical_high;
  // The outlook's predicted peaks, labelled by weekday ("Sat"): tomorrow, then the day after.
  const o = g.outlook;
  const ahead = level != null && o
    ? [o.tomorrow && { r: o.tomorrow, day: weekdayAfter(o.at, 1) }, o.day_after && { r: o.day_after, day: weekdayAfter(o.at, 2) }].filter((d) => !!d)
    : [];
  const values = [g.level, min, max, tLow, tHigh, ...(link.levels ? Object.values(link.levels) : []), ...ahead.map((d) => d.r.level)].filter((v): v is number => v != null && Number.isFinite(v));
  if (min == null && max == null && (tLow == null || tHigh == null)) return null;
  if (values.length < 2) return null;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, 0.1);
  lo -= pad;
  hi += pad;
  /** Pills near either end of the bar align to that end instead of centring (keeps them on screen). */
  const edge = (v: number) => {
    const p = (v - lo) / (hi - lo);
    return p < 0.12 ? 'at-start' : p > 0.88 ? 'at-end' : '';
  };
  const pct = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%` });
  const zone = (cls: string, a: number, b: number) => {
    const s = span(a, b);
    return h('div', { class: `bb-zone ${cls}`, style: `left:${s.left};width:${s.width}` });
  };

  const zones: HTMLElement[] = [];
  const pl = link.basis === 'paddler' || link.basis === 'community' || link.basis === 'manual' ? link.levels : null;
  if (pl) {
    // Paddler scale: each step runs from its threshold to the next one.
    const edges: Array<[string, number, number]> = [
      ['s-empty', lo, pl.scrape],
      ['s-scrape', pl.scrape, pl.low],
      ['s-low', pl.low, pl.medium],
      ['s-medium', pl.medium, pl.high],
      ['s-high', pl.high, pl.very_high],
      ['s-very_high', pl.very_high, pl.huge],
      ['s-huge', pl.huge, hi],
    ];
    for (const [cls, a, b] of edges) if (b > a) zones.push(zone(`bb-step ${cls}`, Math.max(a, lo), Math.min(b, hi)));
  } else if (min != null || max != null) {
    const runFrom = min ?? lo;
    const runTo = max ?? hi;
    if (min != null) zones.push(zone('bb-low', lo, min));
    zones.push(zone('bb-run', runFrom, runTo));
    if (max != null) zones.push(zone('bb-high', max, hi));
  }

  const typical =
    tLow != null && tHigh != null
      ? (() => {
          const s = span(tLow, tHigh);
          return h('div', { class: 'bb-typical', style: `left:${s.left};width:${s.width}`, title: `Typical range ${formatLevel(tLow)} to ${formatLevel(tHigh)}` });
        })()
      : null;

  const step = niceStep(hi - lo);
  const ticks: HTMLElement[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    ticks.push(h('span', { class: 'bb-tick', style: `left:${pct(v)}` }, v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)));
  }

  // Each predicted peak: a dotted line up to its own label row, with a weekday pill.
  const forecast = ahead.map((d, i) =>
    h('div', { class: `bb-fc-marker bb-fc-row${i + 1}`, style: `left:${pct(d.r.level)}` }, h('span', { class: `bb-pill bb-pill-tomorrow ${edge(d.r.level)}` }, `${d.day} ${formatLevel(d.r.level)}`)),
  );

  const marker =
    level != null
      ? h('div', { class: 'bb-marker', style: `left:${pct(level)}` }, h('span', { class: `bb-pill bb-pill-now ${edge(level)}` }, `Now ${formatLevel(level)}`))
      : null;

  const parts: string[] = [level != null ? `Current level ${formatLevel(level)}.` : 'No current reading.'];
  if (min != null && max != null) parts.push(`Runnable between ${formatLevel(min)} and ${formatLevel(max)}.`);
  else if (min != null) parts.push(`Runnable from ${formatLevel(min)}.`);
  else if (max != null) parts.push(`Too high above ${formatLevel(max)}.`);
  if (tLow != null && tHigh != null) parts.push(`Typical range ${formatLevel(tLow)} to ${formatLevel(tHigh)}.`);
  for (const d of ahead) parts.push(`${d.day} about ${formatLevel(d.r.level)}, likely ${formatLevel(d.r.lo)} to ${formatLevel(d.r.hi)}.`);

  const bar = h(
    'div',
    { class: `bandbar${ahead.length ? ' has-forecast' : ''}${ahead.length > 1 ? ' has-forecast-2' : ''}`, role: 'img', 'aria-label': parts.join(' ') },
    h('div', { class: 'bb-track' }, zones, typical, forecast, marker),
    h('div', { class: 'bb-scale', 'aria-hidden': 'true' }, ticks),
    h(
      'div',
      { class: 'bb-key', 'aria-hidden': 'true' },
      !pl && (min != null || max != null) ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-run' }), 'Paddling band') : null,
      typical ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-typical-swatch' }), 'Typical range') : null,
      ahead.length ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-fc-swatch' }), 'Predicted peak') : null,
    ),
  );
  return pl ? h('div', { class: 'bandbar-wrap' }, bar, stepLadder(pl, link.step, link.step_tomorrow, o ? weekdayAfter(o.at, 1) : 'Tomorrow')) : bar;
}

/** The paddler scale as labelled chips: colour, name and the level each step starts at; the current step is highlighted. */
function stepLadder(pl: PaddlerLevels, current: PaddlerStep | null, tomorrow: PaddlerStep | null, tomorrowDay: string): HTMLElement {
  const steps: Array<[PaddlerStep, string]> = [
    ['empty', `under ${formatLevel(pl.scrape)}`],
    ['scrape', `from ${formatLevel(pl.scrape)}`],
    ['low', `from ${formatLevel(pl.low)}`],
    ['medium', `from ${formatLevel(pl.medium)}`],
    ['high', `from ${formatLevel(pl.high)}`],
    ['very_high', `from ${formatLevel(pl.very_high)}`],
    ['huge', `from ${formatLevel(pl.huge)}`],
  ];
  return h(
    'ol',
    { class: 'step-ladder', 'aria-label': 'Paddler level scale' },
    steps.map(([step, range]) =>
      h(
        'li',
        { class: `step-chip s-${step}`, 'aria-current': step === current ? 'true' : null },
        h('span', { class: 'step-chip-name' }, STEP_LABEL[step]),
        h('span', { class: 'step-chip-range' }, range),
        step === current ? h('span', { class: 'step-chip-now' }, 'Now') : null,
        step === tomorrow && tomorrow !== current ? h('span', { class: 'step-chip-now step-chip-next' }, tomorrowDay) : null,
      ),
    ),
  );
}

