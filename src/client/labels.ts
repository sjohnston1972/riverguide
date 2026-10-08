// Pure display helpers: wording, units and times. No DOM.

import type { BandBasis, Confidence, PaddlerStep, Relation, SectionStatus, Trend, TypicalStatus } from '../shared/types.ts';

export const STATUS_LABEL: Record<SectionStatus, string> = {
  runnable: 'Runnable',
  low: 'Low',
  high: 'High',
  unknown: 'Unknown',
};

export const TREND_ARROW: Record<Trend, string> = {
  rising: '▲',
  falling: '▼',
  steady: '►',
  unknown: '',
};

export const TREND_LABEL: Record<Trend, string> = {
  rising: 'rising',
  falling: 'falling',
  steady: 'steady',
  unknown: 'trend unknown',
};

/** Where a gauge is relative to the section, completing "<gauge name>, …". */
export const RELATION_LABEL: Record<Relation, string> = {
  'on-section': 'on this section',
  upstream: 'upstream of this section',
  downstream: 'downstream of this section',
  proxy: 'on a nearby river (used as a guide)',
};

export const TYPICAL_LABEL: Record<TypicalStatus, string> = {
  below: 'Below its typical range',
  typical: 'Within its typical range',
  above: 'Above its typical range',
  unknown: 'Typical range unknown',
};

const CHARACTER_LABEL: Record<string, string> = {
  spate: 'Spate',
  'rain-fed': 'Rain-fed',
  'loch-fed': 'Loch-fed',
  'dam-release': 'Dam release',
  tidal: 'Tidal',
};

export function characterLabel(c: string | null): string | null {
  if (!c) return null;
  return CHARACTER_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

export const ESTIMATE_TOOLTIP = 'Thresholds estimated from guidebook descriptions';
export const COMMUNITY_TOOLTIP = 'Thresholds set from community paddling reports';

export function basisWording(basis: BandBasis, confidence: Confidence): string {
  if (basis === 'manual') return 'Set manually';
  if (basis === 'community') return `Set from community paddling reports — ${confidence} confidence`;
  if (basis === 'paddler') return "Set by paddlers on Where's the Water";
  const conf = `${confidence} confidence`;
  if (basis === 'guide') return `Estimated from the guidebook — ${conf}`;
  if (basis === 'duration') return `Guidebook description matched to how often this gauge reaches each level — ${conf}`;
  return `Based on SEPA typical range — ${conf}`;
}

export function formatLevel(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(2)} m`;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'no reading';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown time';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "24 January 2011" from YYYY-MM-DD (or any parseable date). */
/** "14:32" today, "Tue 14:32" on another day (UK time). */
export function clockTime(iso: string, now = Date.now()): string {
  const tz = { timeZone: 'Europe/London' } as const;
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-GB', tz);
  const time = d.toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' });
  return day(d) === day(new Date(now)) ? time : `${d.toLocaleDateString('en-GB', { ...tz, weekday: 'short' })} ${time}`;
}


/** Lower-case, accents and punctuation removed, for forgiving search. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function gradeLabel(grade: string): string {
  return /^grade/i.test(grade) ? grade : `Grade ${grade}`;
}

export const STEP_LABEL: Record<PaddlerStep, string> = {
  empty: 'Empty',
  scrape: 'Scrapeable',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  very_high: 'Very high',
  huge: 'Huge',
};

/** Where's the Water, whose paddler levels, extra sections and release dates are used under CC BY-SA 4.0. */
export const WTW_URL = 'https://www.andyjacksonfund.org.uk/wheres-the-water/';
export const WTW_DATA_URL = 'https://github.com/jriddell/wheres-the-water';
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

export const OUTLOOK_WORDS: Record<'rise' | 'fall' | 'steady', string> = {
  rise: 'Likely to rise',
  fall: 'Likely to drop',
  steady: 'Likely to stay about the same',
};
export const OUTLOOK_ARROW: Record<'rise' | 'fall' | 'steady', string> = { rise: '↗', fall: '↘', steady: '→' };
