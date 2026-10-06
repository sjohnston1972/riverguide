// Normalises the scraped guide data into data/private/sections.raw.json:
// stable slugs, grid references decoded to lat/lon, and the guide text
// grouped for the enrichment step. Output contains guide text, so it stays
// in data/private/ (gitignored).

import { readFileSync, writeFileSync } from 'node:fs';
import { findGridRefs, gridRefToLatLon } from '../src/shared/osgrid.ts';

interface SourceRow {
  name_of_river: string;
  where_is_it: string;
  put_in_take_outs: string;
  approx_length: string;
  time_needed: string;
  access_hassles: string;
  grading: string;
  water_level: string;
  major_hazards: string;
  general_description: string;
  other_notes: string;
  region: string;
  page_name: string;
  url: string;
  last_updated: string;
}

export interface RawSection {
  slug: string;
  page_name: string;
  river_raw: string;
  region: string;
  ukrgb_url: string;
  source_updated: string | null;
  grid_refs: Array<{ ref: string; lat: number; lon: number }>;
  text: {
    where_is_it: string;
    length: string;
    time: string;
    grading: string;
    water_level: string;
    description: string;
    hazards: string;
    access: string;
    other: string;
  };
}

const SOURCE = 'data/private/scotland_rivers_clean.json';
const rows = JSON.parse(readFileSync(SOURCE, 'utf8')) as SourceRow[];

function slugFromUrl(url: string, fallback: string): string {
  const last = url.split('/').filter(Boolean).pop() ?? '';
  const base = last || fallback;
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const seen = new Map<string, number>();
const out: RawSection[] = rows.map((r) => {
  let slug = slugFromUrl(r.url, r.page_name);
  const n = (seen.get(slug) ?? 0) + 1;
  seen.set(slug, n);
  if (n > 1) slug = `${slug}-${n}`;

  const allText = [r.where_is_it, r.put_in_take_outs, r.general_description, r.other_notes, r.access_hassles].join('\n');
  const refs = [...new Set(findGridRefs(allText))]
    .map((ref) => ({ ref, ...gridRefToLatLon(ref)! }))
    .filter((g) => g.lat != null && g.lat > 54.6 && g.lat < 60.9);

  const updated = Date.parse(r.last_updated);
  return {
    slug,
    page_name: r.page_name.trim(),
    river_raw: r.name_of_river.replace(/\.$/, '').trim(),
    region: r.region,
    ukrgb_url: r.url,
    source_updated: Number.isNaN(updated) ? null : new Date(updated).toISOString().slice(0, 10),
    grid_refs: refs,
    text: {
      where_is_it: [r.where_is_it, r.put_in_take_outs].filter(Boolean).join('\n'),
      length: r.approx_length,
      time: r.time_needed,
      grading: r.grading,
      water_level: r.water_level,
      description: r.general_description,
      hazards: r.major_hazards,
      access: r.access_hassles,
      other: r.other_notes,
    },
  };
});

writeFileSync('data/private/sections.raw.json', JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${out.length} sections; ${out.filter((s) => s.grid_refs.length).length} with grid refs`);
