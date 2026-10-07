// Display helpers for scheduled water: dam releases and Falls of Lora ebbs.

import { ukLocalNow } from '../shared/freshets.ts';
import type { DamRelease, LoraEbb } from '../shared/types.ts';
import { h } from './dom.ts';

const UK = 'Europe/London';
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: UK });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: UK });
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: UK });

// Dam times are UK local strings ("2026-07-02T08:00"); read them as UTC and format in UTC so they print as written.
const localDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const asUtc = (local: string) => new Date(`${local}:00Z`);

export const SEPA_FRESHETS_URL = 'https://beta.sepa.scot/topics/water/water-levels/hydropower-scheme-water-releases/';
export const FALLS_INFO_URL = 'https://www.fallsoflora.info/information-for-kayakers-and-playboaters/';

function relDay(key: string, today: string, label: string): string {
  if (key === today) return 'Today';
  const tomorrow = dateKey.format(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000));
  return key === tomorrow ? 'Tomorrow' : label;
}

export function cumecsText(v: number): string {
  return `${v < 1 ? v.toFixed(1) : v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} m³/s`;
}

function hoursText(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${Math.round(hours)} h`;
}

/** One dam release as a row: day, start to end, duration and size; highlighted while running. */
export function damReleaseRow(r: DamRelease, now = ukLocalNow()): HTMLElement {
  const today = now.slice(0, 10);
  const running = r.start <= now && now < r.end;
  const sameDay = r.start.slice(0, 10) === r.end.slice(0, 10);
  const endLabel = sameDay ? r.end.slice(11) : `${r.end.slice(11)} ${relDay(r.end.slice(0, 10), today, localDay.format(asUtc(r.end)))}`;
  return h(
    'li',
    { class: `sched-row${running ? ' is-running' : ''}${r.start.slice(0, 10) === today ? ' is-today' : ''}` },
    h('span', { class: 'sched-day' }, relDay(r.start.slice(0, 10), today, localDay.format(asUtc(r.start)))),
    h('span', { class: 'sched-time' }, `${r.start.slice(11)} to ${endLabel}`),
    h('span', { class: 'sched-meta' }, h('span', null, hoursText(r.hours)), h('span', { class: 'sched-size', title: `${Math.round(r.volume_m3).toLocaleString('en-GB')} m³ in total` }, cumecsText(r.cumecs))),
    running ? h('span', { class: 'sched-live' }, 'Running now') : null,
  );
}

export const ebbDayKey = (e: LoraEbb) => dateKey.format(new Date(e.main_wave));

/** One Falls of Lora ebb as a row: day, when the main wave runs, size and Oban range. */
export function ebbRow(e: LoraEbb, now = Date.now()): HTMLElement {
  const today = dateKey.format(new Date(now));
  const start = Date.parse(e.ebb_start);
  const end = Date.parse(e.ebb_end);
  const running = start <= now && now < end;
  const t = (iso: string) => timeFmt.format(new Date(iso));
  return h(
    'li',
    { class: `sched-row${running ? ' is-running' : ''}${ebbDayKey(e) === today ? ' is-today' : ''}${e.daylight ? '' : ' is-dark'}` },
    h('span', { class: 'sched-day' }, relDay(ebbDayKey(e), today, dayFmt.format(new Date(e.main_wave)))),
    h('span', { class: 'sched-time' }, `Wave from ${t(e.main_wave)}`),
    h(
      'span',
      { class: 'sched-meta' },
      h('span', null, `Ebb ${t(e.ebb_start)} to ${t(e.ebb_end)}`),
      h('span', { class: `tide-size tide-${e.size}` }, e.size === 'big' ? 'Big' : 'Working'),
      h('span', { title: 'Oban tidal range, high water to the following low water' }, `${e.range_m.toFixed(1)} m range`),
      e.daylight ? null : h('span', { class: 'sched-dark' }, 'After dark'),
    ),
    running ? h('span', { class: 'sched-live' }, 'Ebbing now') : null,
  );
}

/** Ebb timings in words, for the detail under the next ebb. */
export function ebbTimeline(e: LoraEbb): HTMLElement {
  const t = (iso: string) => timeFmt.format(new Date(iso));
  return h(
    'dl',
    { class: 'tide-timeline' },
    h('div', null, h('dt', null, 'High water Oban'), h('dd', null, t(e.high_water))),
    h('div', null, h('dt', null, 'Ebb starts'), h('dd', null, t(e.ebb_start))),
    h('div', null, h('dt', null, 'Main wave'), h('dd', null, `from about ${t(e.main_wave)}`)),
    h('div', null, h('dt', null, 'Low water Oban'), h('dd', null, t(e.low_water))),
    h('div', null, h('dt', null, 'Flow reverses'), h('dd', null, t(e.ebb_end))),
  );
}
