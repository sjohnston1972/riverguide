// Horizontal "gauge board": current level against the paddling band and the
// gauge's typical range.

import { VERDICT_LABEL } from '../shared/community.ts';
import type { SectionGaugeLink, Verdict } from '../shared/types.ts';
import { h } from './dom.ts';
import { formatLevel } from './labels.ts';

function niceStep(range: number): number {
  for (const s of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]) if (range / s <= 5) return s;
  return 10;
}

/** A community report plotted at the gauge level it was made at. */
export interface ReportDot {
  level: number;
  verdict: Verdict;
}

export function bandBar(link: SectionGaugeLink, dots: ReportDot[] = []): HTMLElement | null {
  const g = link.gauge;
  const level = g.stale ? null : g.level;
  const { min_level: min, max_level: max } = link;
  const tLow = g.typical_low;
  const tHigh = g.typical_high;
  const values = [g.level, min, max, tLow, tHigh, ...dots.map((d) => d.level), ...(link.levels ? Object.values(link.levels) : [])].filter((v): v is number => v != null && Number.isFinite(v));
  if (min == null && max == null && (tLow == null || tHigh == null) && !dots.length) return null;
  if (values.length < 2) return null;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, 0.1);
  lo -= pad;
  hi += pad;
  const pct = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%` });
  const zone = (cls: string, a: number, b: number) => {
    const s = span(a, b);
    return h('div', { class: `bb-zone ${cls}`, style: `left:${s.left};width:${s.width}` });
  };

  const zones: HTMLElement[] = [];
  const pl = link.basis === 'paddler' || link.basis === 'community' ? link.levels : null;
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

  const marker =
    level != null
      ? h('div', { class: 'bb-marker', style: `left:${pct(level)}` }, h('span', { class: 'bb-marker-label' }, formatLevel(level)))
      : null;

  const dotRow = dots.length
    ? h(
        'div',
        { class: 'bb-dots' },
        dots.map((d) => h('span', { class: `bb-dot v-${d.verdict}`, style: `left:${pct(d.level)}`, title: `${VERDICT_LABEL[d.verdict]} at ${formatLevel(d.level)}` })),
      )
    : null;

  const parts: string[] = [level != null ? `Current level ${formatLevel(level)}.` : 'No current reading.'];
  if (min != null && max != null) parts.push(`Runnable between ${formatLevel(min)} and ${formatLevel(max)}.`);
  else if (min != null) parts.push(`Runnable from ${formatLevel(min)}.`);
  else if (max != null) parts.push(`Too high above ${formatLevel(max)}.`);
  if (tLow != null && tHigh != null) parts.push(`Typical range ${formatLevel(tLow)} to ${formatLevel(tHigh)}.`);

  return h(
    'div',
    { class: 'bandbar', role: 'img', 'aria-label': parts.join(' ') },
    h('div', { class: 'bb-track' }, zones, typical, marker),
    dotRow,
    h('div', { class: 'bb-scale', 'aria-hidden': 'true' }, ticks),
    h(
      'div',
      { class: 'bb-key', 'aria-hidden': 'true' },
      pl
        ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-step-key' }), 'Paddler scale: empty, scrapeable, low, medium, high, very high, huge')
        : min != null || max != null
          ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-run' }), 'Paddling band')
          : null,
      typical ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-swatch bb-typical-swatch' }), 'Typical range') : null,
      dots.length ? h('span', { class: 'bb-key-item' }, h('span', { class: 'bb-dot-key' }), `Paddler reports (${dots.length})`) : null,
    ),
  );
}
