// One-off, Claude-assisted enrichment of the river guide.
//
//   Pass A (per section): extract short facts (grade, length, character) and
//                         put-in / take-out locations from the guide text.
//   Geocode:              grid refs are converted exactly; otherwise place
//                         names go to OpenStreetMap Nominatim (≤1 req/s).
//   Pass B (per section): pick SEPA gauges from a nearby shortlist and
//                         propose paddling thresholds with a confidence.
//
// Results are cached per section in data/private/enrich-cache/, so the run is
// resumable; delete a cache file to redo that section. Final output is
// data/enrichment.json — facts and links only, no guide prose — for review.
//
// Usage: npm run data:enrich [-- --limit 5] [-- --only slug1,slug2] [-- --relocate] [-- --relink]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { gridRefToLatLon, type LatLon } from '../src/shared/osgrid.ts';
import { distanceKm, inScotland } from '../src/shared/geo.ts';
import type { SepaStation } from '../src/shared/sepa.ts';
import { describeCurve, type DurationCurve } from '../src/shared/duration.ts';
import type { RawSection } from './build-sections.ts';

const MODEL = 'claude-sonnet-5-5';
const CACHE_DIR = 'data/private/enrich-cache';
const USER_AGENT = 'RiverGuideDataBuild/1.0 (+https://github.com/sjohnston1972/riverguide)';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
// Recompute approximate locations (after geocoding fixes); links are redone only where a point moved.
const relocate = args.includes('--relocate');
// Redo gauge links and thresholds for every selected section (e.g. after a prompt change).
const relink = args.includes('--relink');

const sections = (JSON.parse(readFileSync('data/private/sections.raw.json', 'utf8')) as RawSection[])
  .filter((s) => !only || only.has(s.slug))
  .slice(0, limit);
const gauges = JSON.parse(readFileSync('data/gauges.json', 'utf8')) as SepaStation[];
const gaugeByNo = new Map(gauges.map((g) => [g.station_no, g]));
const durations = (JSON.parse(readFileSync('data/gauge-durations.json', 'utf8')) as { curves: Record<string, { curve: DurationCurve } | null> }).curves;
mkdirSync(CACHE_DIR, { recursive: true });

const client = new Anthropic();
const usage = { input: 0, output: 0, calls: 0 };

// ---------------------------------------------------------------- schemas

const Place = z.object({
  label: z.string().describe('Short factual label in your own words, e.g. "Layby on the A82 below the falls"'),
  grid_ref: z.string().nullable().describe('OS grid reference for this point if the text gives one, copied exactly'),
  geocode_query: z
    .string()
    .nullable()
    .describe('A specific named place a map search could find for this point, e.g. "Bridge of Orchy, Argyll". Null if none.'),
});

const Facts = z.object({
  river: z.string().describe('Clean river name, e.g. "River Etive", "Allt a\' Chaorainn"'),
  section_name: z.string().nullable().describe('Section within the river if any, e.g. "Upper", "Gorge"; null for the whole river'),
  grade_text: z.string().describe('Compact grade, e.g. "3/4 (5)", "2-3", "4+"'),
  grade_min: z.number().nullable().describe('Lowest grade of the main run as a number 1-6 (3/4 -> 3)'),
  grade_max: z.number().nullable().describe('Highest grade including optional/portageable features (e.g. "(5)" -> 5)'),
  length_text: z.string().nullable().describe('Approximate length in a few words, e.g. "6 km"'),
  time_text: z.string().nullable().describe('Typical time in a few words, e.g. "2-3 hours"'),
  character: z
    .enum(['spate', 'rain-fed', 'loch-fed', 'dam-release', 'tidal', 'unknown'])
    .describe('spate = needs recent heavy rain and drops fast; rain-fed = runs after moderate rain; loch-fed = holds water for days; dam-release = runs on hydro releases'),
  put_in: Place.nullable(),
  take_out: Place.nullable(),
  area_query: z.string().nullable().describe('Nearest town/village/glen a map search could find, e.g. "Glen Etive, Highland"'),
});
type Facts = z.infer<typeof Facts>;

const Link = z.object({
  station_no: z.string().describe('station_no copied exactly from the candidate list'),
  relation: z.enum(['on-section', 'upstream', 'downstream', 'proxy']),
  band_mode: z.enum(['absolute', 'days_reached', 'typical_relative', 'none']),
  min: z
    .number()
    .nullable()
    .describe('Lowest runnable level: metres (absolute), % of days the level is reached (days_reached), or typical-range fraction; null if no lower limit'),
  max: z
    .number()
    .nullable()
    .describe('Level above which the run is too high / changes character, in the same unit as min; null if not stated'),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().describe('At most 25 words, in your own words; no quotations from the guide'),
});
const Links = z.object({ links: z.array(Link) });
type LinkT = z.infer<typeof Link>;

// ---------------------------------------------------------------- helpers

interface Located {
  lat: number;
  lon: number;
  precision: 'grid' | 'approx';
}
interface PlaceOut {
  lat: number;
  lon: number;
  label: string;
  precision: 'grid' | 'approx';
}
interface CacheEntry {
  facts?: Facts;
  location?: { point: Located | null; put_in: PlaceOut | null; take_out: PlaceOut | null };
  links?: LinkT[];
}

function cachePath(slug: string) {
  return `${CACHE_DIR}/${slug}.json`;
}
function loadCache(slug: string): CacheEntry {
  return existsSync(cachePath(slug)) ? (JSON.parse(readFileSync(cachePath(slug), 'utf8')) as CacheEntry) : {};
}
function saveCache(slug: string, c: CacheEntry) {
  writeFileSync(cachePath(slug), JSON.stringify(c, null, 1));
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function guideBlock(s: RawSection): string {
  const t = s.text;
  return [
    `Title: ${s.page_name}`,
    `River (as written): ${s.river_raw}`,
    `Region: ${s.region}`,
    `Location / put-in / take-out: ${t.where_is_it}`,
    `Length: ${t.length}`,
    `Time: ${t.time}`,
    `Grading: ${t.grading}`,
    `Water level: ${t.water_level}`,
    `Description: ${t.description}`,
    `Hazards: ${t.hazards}`,
    `Access: ${t.access}`,
    `Other notes: ${t.other}`,
  ].join('\n');
}

async function callClaude<T extends z.ZodType>(schema: T, system: string, user: string, effort: 'low' | 'medium'): Promise<z.infer<T> | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: betaZodOutputFormat(schema) },
      });
      usage.calls++;
      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      if (res.stop_reason === 'refusal') return null;
      return res.parsed_output as z.infer<T> | null;
    } catch (err) {
      const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  return null;
}

// Nominatim: one request at a time, ≥1.1 s apart, results memoised.
const geocodeMemo = new Map<string, LatLon | null>();
let lastGeocode = 0;
let geocodeChain: Promise<unknown> = Promise.resolve();
function geocode(query: string): Promise<LatLon | null> {
  const key = query.trim().toLowerCase();
  if (geocodeMemo.has(key)) return Promise.resolve(geocodeMemo.get(key)!);
  const job = geocodeChain.then(async () => {
    if (geocodeMemo.has(key)) return geocodeMemo.get(key)!;
    const wait = lastGeocode + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeocode = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&viewbox=-8.7,60.9,-0.7,54.6&bounded=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    const body = res.ok ? ((await res.json()) as Array<{ lat: string; lon: string }>) : [];
    const hit = body[0] ? { lat: Number(body[0].lat), lon: Number(body[0].lon) } : null;
    const ok = hit && inScotland(hit) ? hit : null;
    geocodeMemo.set(key, ok);
    return ok;
  });
  geocodeChain = job.catch(() => undefined);
  return job;
}

async function resolvePlace(p: Facts['put_in'], s: RawSection, area: LatLon | null): Promise<PlaceOut | null> {
  if (!p) return null;
  // Only trust a grid reference that literally appears in the source text.
  const ref = p.grid_ref?.replace(/\s+/g, '').toUpperCase();
  if (ref && Object.values(s.text).join(' ').replace(/\s+/g, '').toUpperCase().includes(ref)) {
    const ll = gridRefToLatLon(ref);
    if (ll && inScotland(ll)) return { ...ll, label: p.label, precision: 'grid' };
  }
  if (p.geocode_query) {
    const ll =
      (await geocode(p.geocode_query)) ??
      (p.geocode_query.includes(',') ? await geocode(`${p.geocode_query.split(',')[0]}, Scotland`) : null);
    // Place names repeat across Scotland: reject a geocode far from the
    // section's own grid references, or from its general area.
    if (ll) {
      const nearRefs = s.grid_refs.length === 0 || s.grid_refs.some((g) => distanceKm(g, ll) < 40);
      const nearArea = !area || distanceKm(area, ll) < 35;
      if (nearRefs && nearArea) return { ...ll, label: p.label, precision: 'approx' };
    }
  }
  return null;
}

async function locate(s: RawSection, f: Facts): Promise<NonNullable<CacheEntry['location']>> {
  const area = f.area_query ? await geocode(f.area_query) : null;
  const put_in = await resolvePlace(f.put_in, s, area);
  const take_out = await resolvePlace(f.take_out, s, area);
  let point: Located | null = put_in ?? take_out ?? null;
  if (!point && s.grid_refs.length) point = { lat: s.grid_refs[0].lat, lon: s.grid_refs[0].lon, precision: 'grid' };
  if (!point && area) point = { ...area, precision: 'approx' };
  if (!point) {
    const ll = await geocode(`${f.river}, Scotland`);
    if (ll) point = { ...ll, precision: 'approx' };
  }
  if (point) point = { lat: point.lat, lon: point.lon, precision: point.precision };
  return { point, put_in, take_out };
}

function normRiver(name: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\b(river|water of|abhainn|allt|burn of|the)\b/g, '')
    .replace(/[^a-z]/g, '');
}

function candidates(point: Located | null, f: Facts): Array<SepaStation & { km: number | null }> {
  const river = normRiver(f.river);
  const byRiver = river ? gauges.filter((g) => normRiver(g.river) === river) : [];
  if (!point) return byRiver.slice(0, 8).map((g) => ({ ...g, km: null }));
  const withKm = gauges.map((g) => ({ ...g, km: Math.round(distanceKm(point, g) * 10) / 10 }));
  const near = withKm.filter((g) => g.km <= 40).sort((a, b) => a.km - b.km).slice(0, 10);
  const sameRiver = withKm.filter((g) => byRiver.includes(gaugeByNo.get(g.station_no)!) && g.km <= 100 && !near.includes(g));
  return [...near, ...sameRiver.sort((a, b) => a.km - b.km).slice(0, 4)];
}

// ---------------------------------------------------------------- prompts

const FACTS_SYSTEM = `You extract structured facts about a Scottish whitewater river section from a guidebook entry.
Be accurate and conservative: if the text does not state something, use null.
Labels must be short and in your own words — never copy sentences from the guide.`;

const LINKS_SYSTEM = `You link a Scottish whitewater river section to SEPA river level gauges and estimate paddling thresholds.

Rules:
- Only use station_no values from the candidate list. Return an empty list if no candidate is a sensible indicator.
- relation: on-section (gauge is on the run), upstream/downstream (same river, off the run), proxy (different river that responds to the same rain).
- At most 3 links, best first. Prefer gauges on the same river; a proxy only when nothing on the river is usable.
- band_mode "absolute": the guide gives levels in metres for this specific gauge — copy them into min/max.
- band_mode "days_reached" (use whenever the guide describes water only in words and the gauge has a level-duration curve):
  express min/max as the PERCENTAGE OF DAYS on which the gauge's daily maximum reaches that level. Each candidate lists
  the level reached on 90%, 50%, 30%, 20%, 10%, 5% and 2% of days, from three years of SEPA data.
  min is a larger percentage than max (lower levels are reached more often). Rough guide, adjust to the river's character:
    "runs at most levels / loch-fed, holds water" -> min 80–95
    "needs some rain / after moderate rain" -> min 35–55
    "needs recent heavy rain / medium-high" -> min 20–30
    "needs to be in spate / very high / rain still falling" -> min 8–15 (small steep creeks 5–10)
    "too high / flood / dangerous in high water" -> max 2–5 (big-volume rivers may go to 1)
  You may also use the listed metre values to sanity-check, e.g. a falls that "needs a good covering" on a small creek.
- band_mode "typical_relative": only for a candidate with no duration curve. Express min/max as a fraction of its typical range
  (0 = SEPA median annual minimum, 1 = median annual maximum; the maximum is a flood peak, so spate runs start around 0.3–0.45).
- band_mode "none": the link is useful for watching trends but the guide gives no basis for thresholds.
- confidence: high = guide names this gauge with numbers; medium = same river and clear qualitative guidance; low = proxy or vague guidance.
- Ignore references to non-SEPA gauges (painted gauges, websites) except as hints.
- reason: at most 25 words, your own words, no quotes from the guide.`;

function linksPrompt(s: RawSection, f: Facts, cands: ReturnType<typeof candidates>): string {
  const list = cands
    .map(
      (g) =>
        `- station_no ${g.station_no}: "${g.name}" on ${g.river ?? 'unknown river'} (catchment ${g.catchment ?? '?'})` +
        `${g.km != null ? `, ${g.km} km from the section` : ''}, typical range ${g.typical_low ?? '?'}–${g.typical_high ?? '?'} m` +
        (durations[g.station_no] ? `. Level reached on % of days: ${describeCurve(durations[g.station_no]!.curve)}` : '. No duration curve.'),
    )
    .join('\n');
  return `Section: ${s.page_name} (${f.river}${f.section_name ? `, ${f.section_name}` : ''}), grade ${f.grade_text}, character: ${f.character}.

Guide water-level notes: ${s.text.water_level}
Guide location notes: ${s.text.where_is_it}
Other notes: ${s.text.other}

Candidate SEPA gauges:
${list || '(none)'}`;
}

// ---------------------------------------------------------------- run

let done = 0;
await pool(sections, 8, async (s) => {
  const c = loadCache(s.slug);
  try {
    if (!c.facts) {
      const facts = await callClaude(Facts, FACTS_SYSTEM, guideBlock(s), 'low');
      if (!facts) throw new Error('no facts returned');
      c.facts = facts;
      saveCache(s.slug, c);
    }
    if (relocate && c.location && c.location.point?.precision !== 'grid') {
      const before = c.location.point;
      c.location = await locate(s, c.facts);
      const after = c.location.point;
      if (!before || !after || distanceKm(before, after) > 5) {
        console.log(`  moved ${s.slug}: ${before ? `${before.lat},${before.lon}` : 'none'} -> ${after ? `${after.lat},${after.lon}` : 'none'}`);
        delete c.links;
      }
      saveCache(s.slug, c);
    }
    if (!c.location) {
      c.location = await locate(s, c.facts);
      saveCache(s.slug, c);
    }
    if (relink) delete c.links;
    if (!c.links) {
      const cands = candidates(c.location.point, c.facts);
      const res = cands.length ? await callClaude(Links, LINKS_SYSTEM, linksPrompt(s, c.facts, cands), 'medium') : { links: [] };
      const allowed = new Set(cands.map((g) => g.station_no));
      c.links = (res?.links ?? []).filter((l) => allowed.has(l.station_no)).slice(0, 3);
      saveCache(s.slug, c);
    }
  } catch (err) {
    console.error(`! ${s.slug}: ${(err as Error).message}`);
  }
  done++;
  if (done % 10 === 0 || done === sections.length) {
    const cost = (usage.input * 2 + usage.output * 10) / 1e6;
    console.log(`${done}/${sections.length}  calls=${usage.calls}  ~$${cost.toFixed(2)}`);
  }
});

// Assemble the reviewable public output from every cached section.
const all = JSON.parse(readFileSync('data/private/sections.raw.json', 'utf8')) as RawSection[];
const out = all.flatMap((s) => {
  const c = loadCache(s.slug);
  if (!c.facts || !c.location || !c.links) return [];
  const f = c.facts;
  return [
    {
      slug: s.slug,
      name: s.page_name,
      river: f.river,
      section_name: f.section_name,
      region: s.region,
      grade_text: f.grade_text,
      grade_min: f.grade_min,
      grade_max: f.grade_max,
      length_text: f.length_text,
      time_text: f.time_text,
      character: f.character,
      lat: c.location.point?.lat ?? null,
      lon: c.location.point?.lon ?? null,
      location_precision: c.location.point?.precision ?? null,
      put_in: c.location.put_in,
      take_out: c.location.take_out,
      ukrgb_url: s.ukrgb_url,
      source_updated: s.source_updated,
      links: c.links.map((l) => ({
        station_no: l.station_no,
        relation: l.relation,
        band_mode: l.band_mode,
        min: l.min,
        max: l.max,
        confidence: l.confidence,
        reason: l.reason,
      })),
    },
  ];
});
writeFileSync('data/enrichment.json', JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote data/enrichment.json with ${out.length}/${all.length} sections`);
