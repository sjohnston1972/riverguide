// Rivers list filtering, sorting and URL (de)serialisation. Pure functions.

import type { SectionStatus, SectionSummary } from '../shared/types.ts';
import { normalize } from './labels.ts';

export const REGIONS = ['Far North', 'North East', 'West Highlands', 'Central Highlands', 'Southern Uplands'] as const;

export type StatusFilter = SectionStatus | 'any';
export type SortKey = 'status' | 'name';

export interface Filters {
  q: string;
  region: string; // '' = all
  gmin: number; // 1..6
  gmax: number; // 1..6
  status: StatusFilter;
  sort: SortKey;
  /** Only this device's favourite rivers. */
  fav: boolean;
  /** Only rivers rising now or expected to rise. */
  rise: boolean;
}

export const DEFAULT_FILTERS: Filters = { q: '', region: '', gmin: 1, gmax: 6, status: 'any', sort: 'status', fav: false, rise: false };

const STATUSES: StatusFilter[] = ['any', 'runnable', 'low', 'high', 'unknown'];

function clampGrade(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : fallback;
}

/** `favDefault`: whether the favourites filter is on when the URL doesn't say (on once there are favourites). */
export function filtersFromQuery(search: string, favDefault = false): Filters {
  const p = new URLSearchParams(search);
  const status = (p.get('status') ?? 'any') as StatusFilter;
  let gmin = clampGrade(p.get('gmin'), 1);
  let gmax = clampGrade(p.get('gmax'), 6);
  if (gmin > gmax) [gmin, gmax] = [gmax, gmin];
  return {
    q: (p.get('q') ?? '').slice(0, 80),
    region: (REGIONS as readonly string[]).includes(p.get('region') ?? '') ? p.get('region')! : '',
    gmin,
    gmax,
    status: p.get('now') === '1' ? 'runnable' : STATUSES.includes(status) ? status : 'any',
    sort: p.get('sort') === 'name' ? 'name' : 'status',
    fav: p.get('fav') === '1' ? true : p.get('fav') === '0' ? false : favDefault,
    rise: p.get('rise') === '1',
  };
}

export function filtersToQuery(f: Filters, favDefault = false): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.region) p.set('region', f.region);
  if (f.gmin !== 1) p.set('gmin', String(f.gmin));
  if (f.gmax !== 6) p.set('gmax', String(f.gmax));
  if (f.status !== 'any') p.set('status', f.status);
  if (f.sort !== 'status') p.set('sort', f.sort);
  if (f.fav !== favDefault) p.set('fav', f.fav ? '1' : '0');
  if (f.rise) p.set('rise', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Filters set in the filter panel (search and favourites sit outside it). */
export function activeFilterCount(f: Filters): number {
  return (f.region ? 1 : 0) + (f.gmin !== 1 || f.gmax !== 6 ? 1 : 0) + (f.status !== 'any' ? 1 : 0) + (f.rise ? 1 : 0);
}

/** On the rise: the gauge is rising now (SEPA's indicator) or the outlook expects a rise. */
export function isRising(s: SectionSummary): boolean {
  return !s.stale && (s.trend === 'rising' || s.outlook === 'rise');
}

/** Search, region, grade, favourites and rising; status is applied separately so counts can ignore it. */
export function matchesBase(s: SectionSummary, f: Filters, favs: ReadonlySet<string> = new Set()): boolean {
  if (f.fav && !favs.has(s.slug)) return false;
  if (f.rise && !isRising(s)) return false;
  if (f.region && s.region !== f.region) return false;
  if (f.gmin !== 1 || f.gmax !== 6) {
    const lo = s.grade_min ?? s.grade_max;
    const hi = s.grade_max ?? s.grade_min;
    if (lo == null || hi == null) return false;
    if (lo > f.gmax || hi < f.gmin) return false;
  }
  const q = normalize(f.q);
  if (q) {
    const hay = normalize(`${s.name} ${s.river}`);
    if (!q.split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function applyFilters(
  all: SectionSummary[],
  f: Filters,
  favs: ReadonlySet<string> = new Set(),
): { base: SectionSummary[]; shown: SectionSummary[] } {
  const base = all.filter((s) => matchesBase(s, f, favs));
  const shown = f.status === 'any' ? base.slice() : base.filter((s) => s.status === f.status);
  shown.sort((a, b) => {
    if (f.sort === 'status') {
      const ra = a.status === 'runnable' ? 0 : 1;
      const rb = b.status === 'runnable' ? 0 : 1;
      if (ra !== rb) return ra - rb;
    }
    return a.name.localeCompare(b.name, 'en-GB');
  });
  return { base, shown };
}

// The list URL the user last saw, so "All rivers" returns to the same filters.
let listHref = '/';
export function lastListHref(): string {
  return listHref;
}
export function setLastListHref(href: string): void {
  listHref = href;
}
