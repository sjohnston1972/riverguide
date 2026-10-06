// D1 access: rows -> API objects, with statuses computed from the latest readings.

import { distanceKm } from '../shared/geo.ts';
import { type DurationCurve, pctForLevel } from '../shared/duration.ts';
import { isStale, linkRank, sectionStatus, trendFrom, typicalStatus } from '../shared/status.ts';
import type {
  BandBasis,
  Confidence,
  Gauge,
  GuideText,
  PlacePoint,
  Relation,
  SectionDetail,
  SectionGaugeLink,
  SectionSummary,
  StatusBasis,
} from '../shared/types.ts';

interface GaugeRow {
  station_no: string;
  name: string;
  river: string | null;
  catchment: string | null;
  lat: number;
  lon: number;
  ts_id: string;
  typical_low: number | null;
  typical_high: number | null;
  level: number | null;
  level_at: string | null;
  level_hour_ago: number | null;
  duration_curve: string | null;
}

interface SectionRow {
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
  put_in: string | null;
  take_out: string | null;
  ukrgb_url: string;
  source_updated: string | null;
  guide_text: string | null;
}

interface LinkRow {
  slug: string;
  station_no: string;
  relation: Relation;
  min_level: number | null;
  max_level: number | null;
  basis: BandBasis;
  confidence: Confidence;
  reason: string;
}

const SUMMARY_COLUMNS =
  'slug, name, river, section_name, region, grade_text, grade_min, grade_max, lat, lon, location_precision';

export function toGauge(r: GaugeRow, now = Date.now()): Gauge {
  const stale = isStale(r.level_at, now);
  const curve = parseJson<DurationCurve>(r.duration_curve);
  return {
    station_no: r.station_no,
    name: r.name,
    river: r.river,
    catchment: r.catchment,
    lat: r.lat,
    lon: r.lon,
    level: r.level,
    level_at: r.level_at,
    trend: stale ? 'unknown' : trendFrom(r.level, r.level_hour_ago),
    typical_low: r.typical_low,
    typical_high: r.typical_high,
    typical_status: stale ? 'unknown' : typicalStatus(r.level, r.typical_low, r.typical_high),
    days_reached_pct: stale || r.level == null || !curve?.length ? null : pctForLevel(curve, r.level),
    stale,
  };
}

function toLink(l: LinkRow, gauge: Gauge): SectionGaugeLink {
  return {
    station_no: l.station_no,
    relation: l.relation,
    min_level: l.min_level,
    max_level: l.max_level,
    basis: l.basis,
    confidence: l.confidence,
    reason: l.reason,
    gauge,
    status: sectionStatus(gauge.level, gauge.stale, l.min_level, l.max_level),
  };
}

function headline(links: SectionGaugeLink[]): {
  status: SectionSummary['status'];
  status_basis: StatusBasis;
  link: SectionGaugeLink | null;
} {
  const sorted = [...links].sort((a, b) => linkRank(a) - linkRank(b));
  const banded = sorted.find((l) => l.min_level != null || l.max_level != null);
  if (banded) {
    return { status: banded.status, status_basis: banded.basis === 'manual' ? 'manual' : 'estimate', link: banded };
  }
  const first = sorted[0] ?? null;
  return { status: 'unknown', status_basis: first ? 'typical' : 'none', link: first };
}

function summarise(s: Pick<SectionRow, keyof SectionSummary & keyof SectionRow>, links: SectionGaugeLink[]): SectionSummary {
  const h = headline(links);
  return {
    slug: s.slug,
    name: s.name,
    river: s.river,
    region: s.region,
    grade_text: s.grade_text,
    grade_min: s.grade_min,
    grade_max: s.grade_max,
    lat: s.lat,
    lon: s.lon,
    location_precision: s.location_precision,
    status: h.status,
    status_basis: h.status_basis,
    status_confidence: h.status_basis === 'estimate' || h.status_basis === 'manual' ? (h.link?.confidence ?? null) : null,
    station_no: h.link?.station_no ?? null,
    gauge_name: h.link?.gauge.name ?? null,
    level: h.link?.gauge.level ?? null,
    level_at: h.link?.gauge.level_at ?? null,
    stale: h.link?.gauge.stale ?? false,
    trend: h.link?.gauge.trend ?? 'unknown',
  };
}

async function allGauges(db: D1Database): Promise<Map<string, Gauge>> {
  const { results } = await db.prepare('SELECT * FROM gauges').all<GaugeRow>();
  const now = Date.now();
  return new Map(results.map((r) => [r.station_no, toGauge(r, now)]));
}

export async function listSections(db: D1Database): Promise<SectionSummary[]> {
  const [sections, links, gauges] = await Promise.all([
    db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM sections ORDER BY name`).all<SectionRow>(),
    db.prepare('SELECT * FROM section_gauges ORDER BY rowid').all<LinkRow>(),
    allGauges(db),
  ]);
  const bySlug = new Map<string, SectionGaugeLink[]>();
  for (const l of links.results) {
    const g = gauges.get(l.station_no);
    if (!g) continue;
    const arr = bySlug.get(l.slug) ?? [];
    arr.push(toLink(l, g));
    bySlug.set(l.slug, arr);
  }
  return sections.results.map((s) => summarise(s, bySlug.get(s.slug) ?? []));
}

function parseJson<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export interface DetailWithGuide {
  detail: SectionDetail;
  guide: GuideText | null;
}

/** Section detail. `guide` is returned separately so callers decide whether it may leave the server. */
export async function getSection(db: D1Database, slug: string): Promise<DetailWithGuide | null> {
  const [row, links, gauges] = await Promise.all([
    db.prepare('SELECT * FROM sections WHERE slug = ?').bind(slug).first<SectionRow>(),
    db.prepare('SELECT * FROM section_gauges WHERE slug = ? ORDER BY rowid').bind(slug).all<LinkRow>(),
    allGauges(db),
  ]);
  if (!row) return null;
  const linked = links.results
    .flatMap((l) => {
      const g = gauges.get(l.station_no);
      return g ? [toLink(l, g)] : [];
    })
    .sort((a, b) => linkRank(a) - linkRank(b));
  const linkedNos = new Set(linked.map((l) => l.station_no));
  const point = row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null;
  const nearby = point
    ? [...gauges.values()]
        .filter((g) => !linkedNos.has(g.station_no))
        .map((g) => ({ g, km: distanceKm(point, g) }))
        .filter((x) => x.km <= 20)
        .sort((a, b) => a.km - b.km)
        .slice(0, 4)
        .map((x) => x.g)
    : [];

  const detail: SectionDetail = {
    ...summarise(row, linked),
    length_text: row.length_text,
    time_text: row.time_text,
    character: row.character,
    put_in: parseJson<PlacePoint>(row.put_in),
    take_out: parseJson<PlacePoint>(row.take_out),
    ukrgb_url: row.ukrgb_url,
    source_updated: row.source_updated,
    links: linked,
    nearby_gauges: nearby,
  };
  return { detail, guide: parseJson<GuideText>(row.guide_text) };
}

export async function getGauge(db: D1Database, stationNo: string): Promise<(Gauge & { ts_id: string }) | null> {
  const r = await db.prepare('SELECT * FROM gauges WHERE station_no = ?').bind(stationNo).first<GaugeRow>();
  return r ? { ...toGauge(r), ts_id: r.ts_id } : null;
}

export async function searchGauges(db: D1Database, query: string, limit = 10): Promise<Gauge[]> {
  const like = `%${query.trim().replace(/[%_]/g, '')}%`;
  const { results } = await db
    .prepare('SELECT * FROM gauges WHERE name LIKE ?1 OR river LIKE ?1 OR catchment LIKE ?1 ORDER BY name LIMIT ?2')
    .bind(like, limit)
    .all<GaugeRow>();
  const now = Date.now();
  return results.map((r) => toGauge(r, now));
}
