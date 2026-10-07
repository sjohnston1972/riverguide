// Imports paddler-set level bands, extra sections and scheduled releases from
// Where's the Water (Scottish Canoe Association), whose data/ folder is
// licensed CC BY-SA 4.0: https://github.com/jriddell/wheres-the-water
//
// Writes:
//   data/wtw/*.json         verbatim copies of their data files (CC BY-SA 4.0)
//   data/wtw-import.json    our adaptation: matches to our sections, level bands,
//                           new sections and release dates (also CC BY-SA 4.0)
// Review data/wtw-import.json, then run `npm run data:seed`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { distanceKm } from '../src/shared/geo.ts';
import type { SepaStation } from '../src/shared/sepa.ts';

const REPO = 'jriddell/wheres-the-water';
const COMMIT = process.argv.includes('--latest') ? 'master' : 'ec78813017cffa0822d048256bd27c6a8debd636';
const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`;

interface WtwSection {
  name: string;
  grade: string;
  latitude: string;
  longitude: string;
  put_in_lat: string;
  put_in_long: string;
  get_out_lat: string;
  get_out_long: string;
  gauge_location_code: string;
  river_zone_url?: string;
  guidebook_link: string;
  scrape_value: string;
  low_value: string;
  medium_value: string;
  high_value: string;
  very_high_value: string;
  huge_value: string;
}
interface WtwScheduled {
  name: string;
  grade: string;
  latitude: string;
  longitude: string;
  put_in_lat: string;
  put_in_long: string;
  get_out_lat: string;
  get_out_long: string;
  guidebook_link: string;
  notes: string;
  dates: string[];
}
interface OurSection {
  slug: string;
  name: string;
  river: string;
  region: string;
  lat: number | null;
  lon: number | null;
  ukrgb_url: string;
}

export interface Levels {
  scrape: number;
  low: number;
  medium: number;
  high: number;
  very_high: number;
  huge: number;
}
export interface NewSection {
  slug: string;
  name: string;
  river: string;
  region: string;
  grade_text: string;
  grade_min: number | null;
  grade_max: number | null;
  lat: number;
  lon: number;
  put_in: { lat: number; lon: number; label: string } | null;
  take_out: { lat: number; lon: number; label: string } | null;
}
export interface WtwImport {
  source: string;
  licence: string;
  /** levels is null where Where's the Water has the gauge but no calibrated levels yet. */
  bands: Array<{ slug: string; wtw_name: string; station_no: string; levels: Levels | null; match: 'link' | 'nearby' | 'new'; graph_url: string | null }>;
  new_sections: NewSection[];
  releases: Array<{ slug: string; wtw_name: string; dates: string[]; note: string | null }>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(raw(path));
  if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
  const text = await res.text();
  mkdirSync('data/wtw', { recursive: true });
  writeFileSync(`data/wtw/${path.split('/').pop()}`, text);
  return JSON.parse(text) as T;
}

const sections = await get<WtwSection[]>('data/river-sections-sca-copy.json');
const scheduled = await get<WtwScheduled[]>('data/scheduled-sections-sca-copy.json');
const ours = JSON.parse(readFileSync('data/enrichment.json', 'utf8')) as OurSection[];
const gauges = new Set((JSON.parse(readFileSync('data/gauges.json', 'utf8')) as SepaStation[]).map((g) => g.station_no));

const num = (v: string) => (v === '' || v == null ? NaN : Number(v));
const point = (lat: string, lon: string) => (Number.isFinite(num(lat)) && Number.isFinite(num(lon)) && num(lat) !== 0 ? { lat: num(lat), lon: num(lon) } : null);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['river', 'water', 'the', 'upper', 'lower', 'middle', 'burn'].includes(w)));
const QUALIFIERS = ['top', 'upper', 'middle', 'lower', 'gorge'];
const qualifiers = (s: string) => QUALIFIERS.filter((q) => new RegExp(`\\b${q}\\b`, 'i').test(s));
/** Both names say which part of the river, and they disagree (e.g. "Orchy (Middle)" vs "Orchy upper section"). */
const conflictingPart = (a: string, b: string) => {
  const qa = qualifiers(a);
  const qb = qualifiers(b);
  return qa.length > 0 && qb.length > 0 && !qa.some((q) => qb.includes(q));
};
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, ' ').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

/** Our section for a Where's the Water entry: same guidebook page, else close by with a shared name word. */
function match(w: { name: string; guidebook_link: string; latitude: string; longitude: string; put_in_lat: string; put_in_long: string }): { s: OurSection; how: 'link' | 'nearby' } | null {
  if (w.guidebook_link) {
    const s = ours.find((o) => o.ukrgb_url && o.ukrgb_url === w.guidebook_link);
    if (s) return { s, how: 'link' };
  }
  const p = point(w.put_in_lat, w.put_in_long) ?? point(w.latitude, w.longitude);
  if (!p) return null;
  const ww = words(w.name);
  const near = ours
    .filter((o) => o.lat != null && o.lon != null)
    .map((o) => ({ o, km: distanceKm(p, { lat: o.lat!, lon: o.lon! }) }))
    .filter((x) => x.km <= 3 && [...words(`${x.o.name} ${x.o.river}`)].some((t) => ww.has(t)) && !conflictingPart(w.name, `${x.o.name} ${x.o.slug}`))
    .sort((a, b) => a.km - b.km)[0];
  return near ? { s: near.o, how: 'nearby' } : null;
}

function nearestRegion(p: { lat: number; lon: number }): string {
  return ours
    .filter((o) => o.lat != null)
    .map((o) => ({ r: o.region, km: distanceKm(p, { lat: o.lat!, lon: o.lon! }) }))
    .sort((a, b) => a.km - b.km)[0].r;
}

const usedSlugs = new Set(ours.map((o) => o.slug));
function newSection(w: WtwSection | WtwScheduled): NewSection | null {
  const p = point(w.latitude, w.longitude) ?? point(w.put_in_lat, w.put_in_long);
  if (!p) return null;
  let slug = slugify(w.name);
  while (usedSlugs.has(slug)) slug += '-2';
  usedSlugs.add(slug);
  const grades = (w.grade.match(/[1-6]/g) ?? []).map(Number);
  const putIn = point(w.put_in_lat, w.put_in_long);
  const takeOut = point(w.get_out_lat, w.get_out_long);
  return {
    slug,
    name: w.name,
    river: w.name.replace(/\s*\(.*$/, '').trim(),
    region: nearestRegion(p),
    grade_text: w.grade || '?',
    grade_min: grades.length ? Math.min(...grades) : null,
    grade_max: grades.length ? Math.max(...grades) : null,
    lat: p.lat,
    lon: p.lon,
    put_in: putIn ? { ...putIn, label: 'Put-in' } : null,
    take_out: takeOut && (!putIn || distanceKm(putIn, takeOut) > 0.05) ? { ...takeOut, label: 'Take-out' } : null,
  };
}

/** Only rivermap.org graph links, normalised (the source has spaces in the fragment). */
function graphUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' && url.hostname === 'graph.rivermap.org' ? url.href : null;
  } catch {
    return null;
  }
}

const out: WtwImport = {
  source: `https://github.com/${REPO}/tree/${COMMIT}/data`,
  licence: "CC BY-SA 4.0. Adapted from Where's the Water (Scottish Canoe Association).",
  bands: [],
  new_sections: [],
  releases: [],
};

for (const w of sections) {
  const levels: Levels = {
    scrape: num(w.scrape_value),
    low: num(w.low_value),
    medium: num(w.medium_value),
    high: num(w.high_value),
    very_high: num(w.very_high_value),
    huge: num(w.huge_value),
  };
  const vals = Object.values(levels);
  // All-equal values (usually zeros) are placeholders for rivers not yet calibrated.
  const calibrated = vals.every(Number.isFinite) && vals.every((v, i) => i === 0 || v >= vals[i - 1]) && levels.huge > levels.scrape;
  if (!gauges.has(w.gauge_location_code)) {
    console.log(`  skip ${w.name}: gauge ${w.gauge_location_code} not in our gauge list`);
    continue;
  }
  if (!calibrated) console.log(`  ${w.name}: no calibrated levels yet, gauge link only`);
  // Where's the Water's calibration graph (rivermap.org) for this river, shown on our river page.
  const graph_url = calibrated ? graphUrl(w.river_zone_url) : null;
  const m = match(w);
  // An alternative gauge for a section already matched ("(New Gauge)") is dropped; a different
  // section that happens to match the same one of ours becomes a new section instead.
  const taken = m && out.bands.some((b) => b.slug === m.s.slug);
  if (m && taken && /gauge/i.test(w.name)) {
    console.log(`  skip ${w.name}: alternative gauge for ${m.s.slug}`);
    continue;
  }
  if (m && !taken) {
    out.bands.push({ slug: m.s.slug, wtw_name: w.name, station_no: w.gauge_location_code, levels: calibrated ? levels : null, match: m.how, graph_url });
    continue;
  }
  const s = newSection(w);
  if (!s) continue;
  out.new_sections.push(s);
  out.bands.push({ slug: s.slug, wtw_name: w.name, station_no: w.gauge_location_code, levels: calibrated ? levels : null, match: 'new', graph_url });
}

for (const w of scheduled) {
  const dates = [...new Set((w.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!dates.length) continue;
  const m = match(w);
  const slug = m?.s.slug ?? out.new_sections.find((n) => n.name === w.name)?.slug ?? newSection(w)?.slug;
  if (!slug) continue;
  if (!m && !out.new_sections.some((n) => n.slug === slug)) out.new_sections.push(newSectionFromSlug(w, slug));
  out.releases.push({ slug, wtw_name: w.name, dates, note: w.notes?.trim() || null });
}

function newSectionFromSlug(w: WtwScheduled, slug: string): NewSection {
  usedSlugs.delete(slug);
  const s = newSection(w)!;
  return { ...s, slug };
}

writeFileSync('data/wtw-import.json', JSON.stringify(out, null, 1) + '\n');
const by = (k: string) => out.bands.filter((b) => b.match === k).length;
console.log(
  `gauge links: ${out.bands.length} (${out.bands.filter((b) => b.levels).length} with levels; ${by('link')} by guide link, ${by('nearby')} nearby, ${by('new')} new) | new sections: ${out.new_sections.length} | release calendars: ${out.releases.length}`,
);
