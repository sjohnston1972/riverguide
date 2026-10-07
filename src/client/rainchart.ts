// Hourly rain for the next 48 hours: a plain-English summary plus a labelled
// bar chart (mm per hour on a fixed-ish scale, times every 6 hours, bars
// coloured by Met Office rain-rate bands).

import type { WeatherHour } from '../shared/types.ts';
import { h } from './dom.ts';

/** An hour counts as wet from this much rain (mm). */
const WET_MM = 0.1;
/** Dry gaps up to this many hours don't split a spell of rain. */
const MAX_GAP_HOURS = 2;
/** A spell with less rain than this (mm) is drizzle and doesn't lead the summary. */
const SIGNIFICANT_MM = 0.5;

export type RainIntensity = 'slight' | 'moderate' | 'heavy';

/** Met Office rain-rate bands: slight < 0.5 mm/h, moderate 0.5–4 mm/h, heavy ≥ 4 mm/h. */
export function intensity(mmPerHour: number): RainIntensity {
  if (mmPerHour >= 4) return 'heavy';
  if (mmPerHour >= 0.5) return 'moderate';
  return 'slight';
}

const UK = 'Europe/London';
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit' });
const dayHourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'short' });
const ukHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: 'numeric', hourCycle: 'h23' }).format(d));
const ukDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: UK }).format(d);

interface Spell {
  start: number;
  end: number; // inclusive index of last wet hour
  total: number;
  peak: number;
  peakAt: number;
}

export function rainSpells(hours: WeatherHour[]): Spell[] {
  const spells: Spell[] = [];
  let cur: Spell | null = null;
  hours.forEach((x, i) => {
    if (x.rain_mm < WET_MM) return;
    if (cur && i - cur.end - 1 <= MAX_GAP_HOURS) {
      cur.end = i;
    } else {
      cur = { start: i, end: i, total: 0, peak: 0, peakAt: i };
      spells.push(cur);
    }
  });
  for (const s of spells) {
    for (let i = s.start; i <= s.end; i++) {
      s.total += hours[i].rain_mm;
      if (hours[i].rain_mm > s.peak) {
        s.peak = hours[i].rain_mm;
        s.peakAt = i;
      }
    }
  }
  return spells;
}

/** "Sat 14:00", or just "14:00" when it is the same UK day as `ref`. */
function when(iso: string, ref: string): string {
  const d = new Date(iso);
  return ukDay(d) === ukDay(new Date(ref)) ? hourFmt.format(d) : dayHourFmt.format(d);
}

const mm = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} mm`;

/** Plain-English summary of the next 48 hours of rain. */
export function rainSummary(hours: WeatherHour[]): string {
  if (!hours.length) return 'No forecast available.';
  const spells = rainSpells(hours);
  const now = hours[0].time;
  if (!spells.length) return 'Dry for the next 48 hours.';
  const hourAfter = (i: number) => hours[Math.min(i + 1, hours.length - 1)].time;

  const describe = (s: Spell) => {
    const span = s.end - s.start + 1;
    const heaviest = `heaviest ${s.peak.toFixed(1)} mm/h (${intensity(s.peak)}) around ${when(hours[s.peakAt].time, now)}`;
    return `${mm(s.total)} over ${span} hour${span === 1 ? '' : 's'}, ${heaviest}`;
  };

  // Spells under SIGNIFICANT_MM are drizzle: they don't lead the summary.
  const significant = spells.filter((s) => s.total >= SIGNIFICANT_MM);
  if (!significant.length) {
    const trace = spells.reduce((n, s) => n + s.total, 0);
    return `Mostly dry: just ${mm(trace)} of light drizzle in the next 48 hours.`;
  }
  const [first, ...rest] = significant;
  const drizzleFirst = spells[0] !== first;
  let text =
    first.start === 0
      ? `Raining now until about ${when(hourAfter(first.end), now)}: ${describe(first)}.`
      : `${drizzleFirst ? 'Mostly dry' : 'Dry'} until ${when(hours[first.start].time, now)}, then ${describe(first)}.`;
  if (rest.length) {
    const more = rest.reduce((n, s) => n + s.total, 0);
    text += ` More rain from ${when(hours[rest[0].start].time, now)} (${mm(more)} in total).`;
  } else if (first.end < hours.length - 1) {
    text += ` ${spells.some((s) => s.start > first.end) ? 'Mostly dry' : 'Dry'} from ${when(hourAfter(first.end), now)}.`;
  }
  return text;
}

/** Chart top: at least 2 mm/h so light rain looks light, doubling as needed. */
export function scaleMax(peak: number): number {
  let top = 2;
  while (top < peak) top *= 2;
  return top;
}

export function rainChart(hoursIn: WeatherHour[]): HTMLElement {
  const hours = hoursIn.slice(0, 48);
  const peak = Math.max(0, ...hours.map((x) => x.rain_mm));
  const top = scaleMax(peak);
  const summary = rainSummary(hours);

  const bars = hours.map((x, i) => {
    const d = new Date(x.time);
    const hr = ukHour(d);
    const tick = i > 0 && hr % 6 === 0;
    // Labels close to "Now" would overlap it.
    const label = i === 0 ? 'Now' : i < 5 ? null : hr === 0 ? dayFmt.format(d) : tick ? String(hr).padStart(2, '0') : null;
    const wet = x.rain_mm >= WET_MM;
    return h(
      'div',
      { class: `rc-bar${hr === 0 && i > 0 ? ' rc-day' : tick ? ' rc-tick' : ''}`, title: `${dayHourFmt.format(d)}: ${x.rain_mm.toFixed(1)} mm` },
      wet ? h('span', { class: `rc-fill rc-${intensity(x.rain_mm)}`, style: `height:${Math.max(3, Math.min(100, (x.rain_mm / top) * 100))}%` }) : null,
      label ? h('span', { class: `rc-x${hr === 0 && i > 0 ? ' rc-x-day' : ''}` }, label) : null,
    );
  });

  const grid = [top, top / 2].map((v) => h('div', { class: 'rc-grid', style: `bottom:${(v / top) * 100}%` }, h('span', { class: 'rc-y' }, `${v} mm/h`)));

  return h(
    'div',
    { class: 'rain-chart' },
    h('p', { class: 'rc-summary' }, summary),
    h(
      'div',
      { class: 'rc-plot', role: 'img', 'aria-label': `Hourly rain for the next 48 hours. ${summary}` },
      grid,
      h('div', { class: 'rc-bars' }, bars),
    ),
    h(
      'p',
      { class: 'rc-key', 'aria-hidden': 'true' },
      h('span', null, h('span', { class: 'rc-sw rc-slight' }), 'Light, under 0.5 mm/h'),
      h('span', null, h('span', { class: 'rc-sw rc-moderate' }), 'Moderate'),
      h('span', null, h('span', { class: 'rc-sw rc-heavy' }), 'Heavy, 4 mm/h or more'),
    ),
  );
}
