// Builds data/private/seed.sql from:
//   data/gauges.json        SEPA gauge snapshot (public)
//   data/gauge-durations.json  level-duration curves from SEPA daily maxima (public)
//   data/enrichment.json    reviewed facts + gauge links (public)
//   data/wtw-import.json    paddler levels, extra sections and release dates adapted from
//                           Where's the Water (CC BY-SA 4.0)
//   data/overrides.json     manual corrections — always win (public)
//
// Sections are upserted, never bulk-deleted: community reports reference them
// (ON DELETE CASCADE), so only sections that no longer exist are removed.
//   data/private/sections.raw.json   guide text (private, server-side only)
//
// Apply with:  npx wrangler d1 execute riverguide --local  --file data/private/seed.sql
//              npx wrangler d1 execute riverguide --remote --file data/private/seed.sql

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { type DurationCurve, levelForPct } from '../src/shared/duration.ts';
import { relativeToAbsolute } from '../src/shared/status.ts';
import type { SepaStation } from '../src/shared/sepa.ts';
import type { GuideText } from '../src/shared/types.ts';
import type { RawSection } from './build-sections.ts';
import type { WtwImport } from './import-wtw.ts';

interface EnrichedLink {
  station_no: string;
  relation: string;
  band_mode: 'absolute' | 'days_reached' | 'typical_relative' | 'none';
  min: number | null;
  max: number | null;
  confidence: string;
  reason: string;
}
interface Enriched {
  slug: string;
  name: string;
  river: string;
  section_name: string | null;
  region: string;
  grade_text: string;
  grade_min: number | null;
  grade_max: number | null;
  length_text: string | null;
  time_text: string | null;
  character: string | null;
  lat: number | null;
  lon: number | null;
  location_precision: 'grid' | 'approx' | null;
  put_in: { lat: number; lon: number; label: string } | null;
  take_out: { lat: number; lon: number; label: string } | null;
  ukrgb_url: string;
  source_updated: string | null;
  links: EnrichedLink[];
}
// data/overrides.json is hand-edited, so it is checked strictly: a misspelt key fails the build
// instead of being silently ignored.
const ManualLink = z.strictObject({
  station_no: z.string().regex(/^\d+$/),
  relation: z.enum(['on-section', 'upstream', 'downstream', 'proxy']),
  min_level: z.number().nullable(),
  max_level: z.number().nullable(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  reason: z.string().min(1),
});
const SectionOverride = z.strictObject({
  name: z.string(),
  river: z.string(),
  section_name: z.string().nullable(),
  region: z.string(),
  grade_text: z.string(),
  grade_min: z.number().nullable(),
  grade_max: z.number().nullable(),
  length_text: z.string().nullable(),
  time_text: z.string().nullable(),
  character: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  location_precision: z.enum(['grid', 'approx']).nullable(),
  put_in: z.object({ lat: z.number(), lon: z.number(), label: z.string() }).nullable(),
  take_out: z.object({ lat: z.number(), lon: z.number(), label: z.string() }).nullable(),
  ukrgb_url: z.string(),
  source_updated: z.string().nullable(),
}).partial();
const OverridesSchema = z.strictObject({
  sections: z.record(z.string(), SectionOverride).optional(),
  /** Replaces all estimated links for the section. */
  links: z.record(z.string(), z.array(ManualLink)).optional(),
});
type Overrides = z.infer<typeof OverridesSchema>;

const read = <T>(p: string): T => {
  if (!existsSync(p)) throw new Error(`build-seed: ${p} is missing. Run the data pipeline first (npm run data:all, or the step that writes it).`);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
};
const gauges = read<SepaStation[]>('data/gauges.json');
const enriched = read<Enriched[]>('data/enrichment.json');
const parsedOverrides = OverridesSchema.safeParse(read<unknown>('data/overrides.json'));
if (!parsedOverrides.success) {
  throw new Error(`build-seed: data/overrides.json is invalid:\n${z.prettifyError(parsedOverrides.error)}`);
}
const overrides: Overrides = parsedOverrides.data;
const raw = new Map(read<RawSection[]>('data/private/sections.raw.json').map((s) => [s.slug, s]));
const gaugeByNo = new Map(gauges.map((g) => [g.station_no, g]));
const curves = read<{ curves: Record<string, { curve: DurationCurve } | null> }>('data/gauge-durations.json').curves;
const curveOf = (stationNo: string) => curves[stationNo]?.curve ?? null;
const wtw = read<WtwImport>('data/wtw-import.json');
// Level-outlook models (scripts/fit-forecast.ts); absent for gauges no section uses. Required: without
// it every outlook silently falls back to a trend-only direction.
const forecast = read<{ models: Record<string, unknown | null> }>('data/gauge-forecast.json').models;
const forecastOf = (stationNo: string) => forecast[stationNo] ?? null;

function sql(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}
const row = (vals: unknown[]) => `(${vals.map(sql).join(', ')})`;

const out: string[] = ['DELETE FROM section_gauges;', 'DELETE FROM releases;'];

/** Every link written to the seed: thresholds must be numbers (or null) and the band the right way round. */
const problems: string[] = [];
function checkLink(slug: string, l: { station_no: string; min_level: number | null; max_level: number | null }): void {
  const bad = (v: number | null) => v != null && !Number.isFinite(v);
  if (bad(l.min_level) || bad(l.max_level)) problems.push(`${slug} / ${l.station_no}: threshold is not a number`);
  else if (l.min_level != null && l.max_level != null && l.min_level >= l.max_level) {
    problems.push(`${slug} / ${l.station_no}: min_level ${l.min_level} is not below max_level ${l.max_level}`);
  }
}
// Where's the Water's ladder for a section's gauge: kept on a manual link to the same gauge.
const wtwBand = new Map(wtw.bands.filter((b) => b.levels).map((b) => [`${b.slug}|${b.station_no}`, b]));
const SECTION_COLS = [
  'slug', 'name', 'river', 'section_name', 'region', 'grade_text', 'grade_min', 'grade_max', 'length_text', 'time_text', 'character',
  'lat', 'lon', 'location_precision', 'put_in', 'take_out', 'ukrgb_url', 'source_updated', 'guide_text', 'source', 'release_note',
];
const upsertSection = (vals: unknown[]) =>
  `INSERT INTO sections (${SECTION_COLS.join(', ')}) VALUES ${row(vals)} ON CONFLICT(slug) DO UPDATE SET ${SECTION_COLS.slice(1)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')};`;
const releaseNote = new Map(wtw.releases.map((r) => [r.slug, r.note]));
const seedSlugs: string[] = [];

for (const g of gauges) {
  out.push(
    `INSERT INTO gauges (station_no, name, river, catchment, lat, lon, ts_id, typical_low, typical_high, duration_curve, forecast_model) VALUES ${row([
      g.station_no, g.name, g.river, g.catchment, g.lat, g.lon, g.ts_id, g.typical_low, g.typical_high, curveOf(g.station_no), forecastOf(g.station_no),
    ])} ON CONFLICT(station_no) DO UPDATE SET name = excluded.name, river = excluded.river, catchment = excluded.catchment, lat = excluded.lat, lon = excluded.lon, ts_id = excluded.ts_id, typical_low = excluded.typical_low, typical_high = excluded.typical_high, duration_curve = excluded.duration_curve, forecast_model = excluded.forecast_model;`,
  );
}

let linkCount = 0;
let manualCount = 0;
for (const e of enriched) {
  const s = { ...e, ...(overrides.sections?.[e.slug] ?? {}) };
  const t = raw.get(e.slug)?.text;
  const guide: GuideText | null = t
    ? { description: t.description, hazards: t.hazards, access: t.access, water_level: t.water_level, other: [t.where_is_it, t.other].filter(Boolean).join('\n\n') }
    : null;
  seedSlugs.push(s.slug);
  out.push(
    upsertSection([
      s.slug, s.name, s.river, s.section_name, s.region, s.grade_text, s.grade_min, s.grade_max, s.length_text, s.time_text,
      s.character, s.lat, s.lon, s.location_precision, s.put_in, s.take_out, s.ukrgb_url, s.source_updated, guide, 'guidebook',
      releaseNote.get(s.slug) ?? null,
    ]),
  );

  const manual = overrides.links?.[e.slug];
  const links: Array<{
    station_no: string;
    relation: string;
    min_level: number | null;
    max_level: number | null;
    basis: string;
    confidence: string;
    reason: string;
    levels?: unknown;
    calibration_url?: string | null;
  }> = manual
    ? manual.map((m) => {
        // Correcting a threshold shouldn't lose the paddler step ladder for the same gauge.
        const b = wtwBand.get(`${e.slug}|${m.station_no}`);
        return { ...m, basis: 'manual', confidence: m.confidence ?? 'high', levels: b?.levels ?? null, calibration_url: b?.graph_url ?? null };
      })
    : e.links.map((l) => {
        const g = gaugeByNo.get(l.station_no);
        const curve = curveOf(l.station_no);
        const convert = (v: number | null): number | null => {
          if (v == null || l.band_mode === 'none') return null;
          if (l.band_mode === 'absolute') return v;
          if (l.band_mode === 'days_reached') return curve ? levelForPct(curve, v) : null;
          return relativeToAbsolute(v, g?.typical_low ?? null, g?.typical_high ?? null);
        };
        const basis = l.band_mode === 'absolute' ? 'guide' : l.band_mode === 'days_reached' ? 'duration' : 'typical-relative';
        return {
          station_no: l.station_no,
          relation: l.relation,
          min_level: convert(l.min),
          max_level: convert(l.max),
          basis,
          confidence: l.confidence,
          reason: l.reason,
        };
      });
  for (const l of links) {
    if (!gaugeByNo.has(l.station_no)) {
      if (l.basis === 'manual') problems.push(`${e.slug}: manual link names unknown gauge ${l.station_no}`);
      continue;
    }
    checkLink(e.slug, l);
    out.push(
      `INSERT OR REPLACE INTO section_gauges (slug, station_no, relation, min_level, max_level, basis, confidence, reason, levels, calibration_url) VALUES ${row([
        e.slug, l.station_no, l.relation, l.min_level, l.max_level, l.basis, l.confidence, l.reason, l.levels ?? null, l.calibration_url ?? null,
      ])};`,
    );
    linkCount++;
    if (l.basis === 'manual') manualCount++;
  }
}

// ---- Where's the Water (CC BY-SA 4.0): extra sections, paddler levels, release dates ----
for (const n of wtw.new_sections) {
  const s = { ...n, ...(overrides.sections?.[n.slug] ?? {}) };
  seedSlugs.push(s.slug);
  out.push(
    upsertSection([
      s.slug, s.name, s.river, null, s.region, s.grade_text, s.grade_min, s.grade_max, null, null, null,
      s.lat, s.lon, 'grid', s.put_in, s.take_out, '', null, null, 'wtw', releaseNote.get(s.slug) ?? null,
    ]),
  );
}

const estimatedRelation = new Map<string, string>(enriched.flatMap((e) => e.links.map((l): [string, string] => [`${e.slug}|${l.station_no}`, l.relation])));
let paddlerCount = 0;
for (const b of wtw.bands) {
  if (overrides.links?.[b.slug] || !gaugeByNo.has(b.station_no)) continue; // manual links replace everything
  const key = `${b.slug}|${b.station_no}`;
  const relation = estimatedRelation.get(key) ?? 'on-section';
  if (!b.levels) {
    if (estimatedRelation.has(key)) continue; // keep the estimate on a gauge Where's the Water hasn't calibrated
    out.push(
      `INSERT OR REPLACE INTO section_gauges (slug, station_no, relation, min_level, max_level, basis, confidence, reason, levels) VALUES ${row([
        b.slug, b.station_no, relation, null, null, 'paddler', 'medium', "Gauge used by Where's the Water; paddler levels not set yet.", null,
      ])};`,
    );
    linkCount++;
    continue;
  }
  checkLink(b.slug, { station_no: b.station_no, min_level: b.levels.scrape, max_level: b.levels.huge });
  out.push(
    `INSERT OR REPLACE INTO section_gauges (slug, station_no, relation, min_level, max_level, basis, confidence, reason, levels, calibration_url) VALUES ${row([
      b.slug, b.station_no, relation, b.levels.scrape, b.levels.huge, 'paddler', 'high',
      "Levels set by paddlers on Where's the Water.", b.levels, b.graph_url ?? null,
    ])};`,
  );
  linkCount++;
  paddlerCount++;
}

for (const r of wtw.releases) {
  for (const day of r.dates) out.push(`INSERT OR IGNORE INTO releases (slug, day) VALUES ${row([r.slug, day])};`);
}

for (const slug of Object.keys(overrides.sections ?? {})) {
  if (!seedSlugs.includes(slug)) problems.push(`overrides.json: section "${slug}" does not exist`);
}
for (const slug of Object.keys(overrides.links ?? {})) {
  if (!enriched.some((e) => e.slug === slug)) problems.push(`overrides.json: links for "${slug}", which is not a guidebook section`);
}
if (problems.length) throw new Error(`build-seed: ${problems.length} problem(s), seed not written:\n  ${problems.join('\n  ')}`);

// Remove sections that are no longer in the data (their reports go with them).
out.push(`DELETE FROM sections WHERE slug NOT IN (${seedSlugs.map(sql).join(', ')});`);

writeFileSync('data/private/seed.sql', out.join('\n') + '\n');
const releaseDays = wtw.releases.reduce((n, r) => n + r.dates.length, 0);
console.log(
  `seed.sql: ${gauges.length} gauges, ${seedSlugs.length} sections (${wtw.new_sections.length} from Where's the Water), ${linkCount} links (${paddlerCount} paddler, ${manualCount} manual), ${releaseDays} release days`,
);
