// Scheduled water: hydro dam releases (SEPA's freshet schedule, stored in D1)
// and Falls of Lora ebbs (predicted from the Oban tide model).

import tideModel from '../../data/oban-tide.json';
import { cumecs, FRESHET_PAGE, FRESHET_SOURCES, freshetSource, freshetSourceFor, paddlingWindow, ukLocalNow } from '../shared/freshets.ts';
import { ukToday } from '../shared/status.ts';
import { LORA, LORA_SLUG, type LoraEbb, loraEbbs, type TideModel } from '../shared/tides.ts';
import type { DamRelease, DamSchedule, LoraOverview, ReleasesOverview } from '../shared/types.ts';

const MODEL = tideModel as TideModel;
const DAY = 86_400_000;

interface FreshetRow {
  source: string;
  location: string;
  start: string;
  end: string;
  volume_m3: number;
  hours: number;
}

const toRelease = (r: FreshetRow): DamRelease => ({
  start: r.start,
  end: r.end,
  hours: r.hours,
  volume_m3: r.volume_m3,
  cumecs: Math.round(cumecs(r.volume_m3, r.hours) * 100) / 100,
});

const ukDate = (iso: string) => ukToday(new Date(iso));

/** Working Falls of Lora ebbs from now (including one already running) for `days` days. */
export function upcomingEbbs(days: number, now = Date.now()): LoraEbb[] {
  return loraEbbs(MODEL, now, now + days * DAY).filter((e) => Date.parse(e.ebb_end) > now);
}

export function loraOverview(days = 60): LoraOverview {
  return { ebbs: upcomingEbbs(days), min_range: LORA.minRange, big_range: LORA.bigRange, station: MODEL.station };
}

/** Sources with any stored releases (a failed or not-yet-run import leaves Where's the Water dates in use). */
async function loadedSources(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT DISTINCT source FROM freshets').all<{ source: string }>();
  return new Set(results.map((r) => r.source));
}

/** Sections with water scheduled for today's paddling hours (dam release, Falls ebb in daylight, or a Where's the Water date). */
export async function releasingToday(db: D1Database): Promise<Set<string>> {
  const today = ukToday();
  const w = paddlingWindow(today);
  const [wtw, running, loaded] = await Promise.all([
    db.prepare('SELECT slug FROM releases WHERE day = ?').bind(today).all<{ slug: string }>(),
    db.prepare('SELECT DISTINCT source FROM freshets WHERE start < ? AND end > ?').bind(w.to, w.from).all<{ source: string }>(),
    loadedSources(db),
  ]);
  const out = new Set<string>();
  for (const r of wtw.results) if (!coveredBySchedule(r.slug, loaded)) out.add(r.slug);
  for (const r of running.results) for (const s of freshetSource(r.source)?.sections ?? []) out.add(s.slug);
  const now = Date.now();
  if (loraEbbs(MODEL, now - DAY, now + DAY).some((e) => e.daylight && ukDate(e.main_wave) === today)) out.add(LORA_SLUG);
  return out;
}

function coveredBySchedule(slug: string, loaded: Set<string>): boolean {
  if (slug === LORA_SLUG) return true;
  const s = freshetSourceFor(slug);
  return !!s && loaded.has(s.source.key);
}

/** Dam schedule for a section, or null if it isn't below a scheduled dam (or nothing is stored yet). */
export async function damSchedule(db: D1Database, slug: string): Promise<DamSchedule | null> {
  const found = freshetSourceFor(slug);
  if (!found) return null;
  const { source, note } = found;
  const [rows, any] = await Promise.all([
    db.prepare('SELECT * FROM freshets WHERE source = ? AND end > ? ORDER BY start LIMIT 10').bind(source.key, ukLocalNow()).all<FreshetRow>(),
    db.prepare('SELECT 1 FROM freshets WHERE source = ? LIMIT 1').bind(source.key).first(),
  ]);
  if (!any) return null;
  return {
    key: source.key,
    river: source.river,
    dam: source.dam,
    note,
    includes_compensation: !!source.includes_compensation,
    releases: rows.results.map(toRelease),
  };
}

export function sectionEbbs(slug: string): LoraEbb[] | null {
  return slug === LORA_SLUG ? upcomingEbbs(14) : null;
}

/** Every dam in the schedule with its upcoming releases, soonest first. */
export async function releasesOverview(db: D1Database): Promise<ReleasesOverview> {
  const [rows, sections] = await Promise.all([
    db.prepare('SELECT * FROM freshets WHERE end > ? ORDER BY start').bind(ukLocalNow()).all<FreshetRow>(),
    db.prepare('SELECT slug, name, grade_text FROM sections').all<{ slug: string; name: string; grade_text: string }>(),
  ]);
  const bySlug = new Map(sections.results.map((s) => [s.slug, s]));
  const byKey = new Map<string, DamRelease[]>();
  const names = new Map<string, string>();
  for (const r of rows.results) {
    byKey.set(r.source, [...(byKey.get(r.source) ?? []), toRelease(r)]);
    names.set(r.source, r.location);
  }
  const dams: ReleasesOverview['dams'] = FRESHET_SOURCES.map((s) => ({
    key: s.key,
    river: s.river,
    dam: s.dam,
    note: null,
    includes_compensation: !!s.includes_compensation,
    releases: byKey.get(s.key) ?? [],
    sections: s.sections.flatMap((x) => {
      const row = bySlug.get(x.slug);
      return row ? [row] : [];
    }),
  }));
  // Locations not mapped in FRESHET_SOURCES still show, under their schedule name.
  for (const [key, releases] of byKey) {
    if (freshetSource(key)) continue;
    const name = names.get(key) ?? key;
    dams.push({ key, river: name, dam: name, note: null, includes_compensation: false, releases, sections: [] });
  }
  // Soonest next release first; dams with nothing left this season last.
  dams.sort((a, b) => (a.releases[0]?.start ?? '9999').localeCompare(b.releases[0]?.start ?? '9999') || a.river.localeCompare(b.river));
  return { dams, source_url: FRESHET_PAGE };
}
