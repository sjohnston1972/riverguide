// Builds data/private/seed.sql from:
//   data/gauges.json        SEPA gauge snapshot (public)
//   data/enrichment.json    reviewed facts + gauge links (public)
//   data/overrides.json     manual corrections — always win (public)
//   data/private/sections.raw.json   guide text (private, server-side only)
//
// Apply with:  npx wrangler d1 execute riverguide --local  --file data/private/seed.sql
//              npx wrangler d1 execute riverguide --remote --file data/private/seed.sql

import { readFileSync, writeFileSync } from 'node:fs';
import { relativeToAbsolute } from '../src/shared/status.ts';
import type { SepaStation } from '../src/shared/sepa.ts';
import type { GuideText } from '../src/shared/types.ts';
import type { RawSection } from './build-sections.ts';

interface EnrichedLink {
  station_no: string;
  relation: string;
  band_mode: 'absolute' | 'typical_relative' | 'none';
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
interface ManualLink {
  station_no: string;
  relation: string;
  min_level: number | null;
  max_level: number | null;
  confidence?: string;
  reason: string;
}
interface Overrides {
  sections?: Record<string, Partial<Omit<Enriched, 'slug' | 'links'>>>;
  /** Replaces all estimated links for the section. */
  links?: Record<string, ManualLink[]>;
}

const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const gauges = read<SepaStation[]>('data/gauges.json');
const enriched = read<Enriched[]>('data/enrichment.json');
const overrides = read<Overrides>('data/overrides.json');
const raw = new Map(read<RawSection[]>('data/private/sections.raw.json').map((s) => [s.slug, s]));
const gaugeByNo = new Map(gauges.map((g) => [g.station_no, g]));

function sql(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}
const row = (vals: unknown[]) => `(${vals.map(sql).join(', ')})`;

const out: string[] = ['DELETE FROM section_gauges;', 'DELETE FROM sections;'];

for (const g of gauges) {
  out.push(
    `INSERT INTO gauges (station_no, name, river, catchment, lat, lon, ts_id, typical_low, typical_high) VALUES ${row([
      g.station_no, g.name, g.river, g.catchment, g.lat, g.lon, g.ts_id, g.typical_low, g.typical_high,
    ])} ON CONFLICT(station_no) DO UPDATE SET name = excluded.name, river = excluded.river, catchment = excluded.catchment, lat = excluded.lat, lon = excluded.lon, ts_id = excluded.ts_id, typical_low = excluded.typical_low, typical_high = excluded.typical_high;`,
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
  out.push(
    `INSERT INTO sections (slug, name, river, section_name, region, grade_text, grade_min, grade_max, length_text, time_text, character, lat, lon, location_precision, put_in, take_out, ukrgb_url, source_updated, guide_text) VALUES ${row([
      s.slug, s.name, s.river, s.section_name, s.region, s.grade_text, s.grade_min, s.grade_max, s.length_text, s.time_text,
      s.character, s.lat, s.lon, s.location_precision, s.put_in, s.take_out, s.ukrgb_url, s.source_updated, guide,
    ])};`,
  );

  const manual = overrides.links?.[e.slug];
  const links = manual
    ? manual.map((m) => ({ ...m, basis: 'manual', confidence: m.confidence ?? 'high' }))
    : e.links.map((l) => {
        const g = gaugeByNo.get(l.station_no);
        const rel = l.band_mode === 'typical_relative';
        return {
          station_no: l.station_no,
          relation: l.relation,
          min_level: l.band_mode === 'none' ? null : rel ? relativeToAbsolute(l.min, g?.typical_low ?? null, g?.typical_high ?? null) : l.min,
          max_level: l.band_mode === 'none' ? null : rel ? relativeToAbsolute(l.max, g?.typical_low ?? null, g?.typical_high ?? null) : l.max,
          basis: rel ? 'typical-relative' : 'guide',
          confidence: l.confidence,
          reason: l.reason,
        };
      });
  for (const l of links) {
    if (!gaugeByNo.has(l.station_no)) continue;
    out.push(
      `INSERT OR REPLACE INTO section_gauges (slug, station_no, relation, min_level, max_level, basis, confidence, reason) VALUES ${row([
        e.slug, l.station_no, l.relation, l.min_level, l.max_level, l.basis, l.confidence, l.reason,
      ])};`,
    );
    linkCount++;
    if (l.basis === 'manual') manualCount++;
  }
}

writeFileSync('data/private/seed.sql', out.join('\n') + '\n');
console.log(`seed.sql: ${gauges.length} gauges, ${enriched.length} sections, ${linkCount} links (${manualCount} manual)`);
