// Scheduled jobs: latest readings for every gauge (15 min) and gauge metadata (daily).

import type { ForecastModel } from '../shared/forecast.ts';
import { parseJson } from '../shared/json.ts';
import { fetchLevelStations, fetchRisingFallingIds, fetchSeriesValues, fetchSeriesWindow, latestAndHourAgo } from '../shared/sepa.ts';
import { dayChange, gaugeTrend, isStale, ukToday } from '../shared/status.ts';
import type { GaugeOutlook, LevelHistory } from '../shared/types.ts';
import { computeOutlook, type StoredRain } from './outlook.ts';

const BATCH = 150; // ts_ids per KiWIS request; keeps URLs well under limits
const RAIN_BATCH = 50; // locations per Open-Meteo request
/** Rain older than this is refetched (it is also refetched as soon as the UK day changes). */
const RAIN_REFRESH_MS = 55 * 60_000;
/** An unchanged outlook is still rewritten this often, so its timestamp stays within the age the API accepts. */
const OUTLOOK_REWRITE_MS = 60 * 60_000;
/** A gauge's level a day ago is refetched once it is this much older than exactly 24 h before now. */
const DAY_AGO_REFRESH_MS = 60 * 60_000;

/** The gauge columns one poll reads and may rewrite. */
export interface GaugePollRow {
  station_no: string;
  ts_id: string;
  rf_ts_id: string | null;
  lat: number;
  lon: number;
  level: number | null;
  level_at: string | null;
  level_hour_ago: number | null;
  level_day_ago: number | null;
  level_day_ago_at: string | null;
  trend_sepa: number | null;
  trend_sepa_at: string | null;
  forecast_model: string | null;
  rain: string | null;
  outlook: string | null;
}

/** What one poll fetched, by station. A station missing from a map keeps its stored value. */
export interface PollFetched {
  levels: Map<string, { level: number; at: string; hourAgo: number | null }>;
  dayAgo: Map<string, { level: number; at: string }>;
  flags: Map<string, { flag: number; at: string }>;
  rain: Map<string, StoredRain>;
}

type Written = Pick<
  GaugePollRow,
  'level' | 'level_at' | 'level_hour_ago' | 'level_day_ago' | 'level_day_ago_at' | 'trend_sepa' | 'trend_sepa_at' | 'rain' | 'outlook'
>;

const parse = parseJson;

/** True when a gauge's stored rain is missing, from an earlier UK day, or due a refresh. */
export function rainIsDue(rain: string | null, now: Date): boolean {
  const r = parse<StoredRain>(rain);
  return !r || r.day !== ukToday(now) || now.getTime() - Date.parse(r.at) >= RAIN_REFRESH_MS;
}

/** Same outlook apart from when it was computed. */
function sameOutlook(a: GaugeOutlook | null, b: GaugeOutlook | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify({ ...a, at: '' }) === JSON.stringify({ ...b, at: '' });
}

/**
 * A gauge's columns after merging in what this poll fetched and recomputing its
 * outlook, or null when nothing would change (so the row is not rewritten).
 */
export function nextGaugeState(row: GaugePollRow, fetched: PollFetched, now: Date): Written | null {
  const lv = fetched.levels.get(row.station_no);
  const da = fetched.dayAgo.get(row.station_no);
  const fl = fetched.flags.get(row.station_no);
  const rn = fetched.rain.get(row.station_no);
  const next: Written = {
    level: lv ? lv.level : row.level,
    level_at: lv ? lv.at : row.level_at,
    level_hour_ago: lv ? lv.hourAgo : row.level_hour_ago,
    level_day_ago: da ? da.level : row.level_day_ago,
    level_day_ago_at: da ? da.at : row.level_day_ago_at,
    trend_sepa: fl ? fl.flag : row.trend_sepa,
    trend_sepa_at: fl ? fl.at : row.trend_sepa_at,
    rain: rn ? JSON.stringify(rn) : row.rain,
    outlook: row.outlook,
  };

  if (row.forecast_model) {
    const t = now.getTime();
    const o =
      next.level == null || isStale(next.level_at, t)
        ? null
        : computeOutlook(
            next.level,
            gaugeTrend(next.level, next.level_hour_ago, next.level_at, next.trend_sepa, next.trend_sepa_at),
            parse<ForecastModel>(row.forecast_model),
            parse<StoredRain>(next.rain),
            t,
            dayChange(next.level, next.level_at, next.level_day_ago, next.level_day_ago_at),
          );
    const old = parse<GaugeOutlook>(row.outlook);
    const keep = sameOutlook(old, o) && (!old || t - Date.parse(old.at) < OUTLOOK_REWRITE_MS);
    if (!keep) next.outlook = o ? JSON.stringify(o) : null;
  }

  const changed = (Object.keys(next) as Array<keyof Written>).some((k) => next[k] !== row[k]);
  return changed ? next : null;
}

/**
 * Runs `fetchBatch` over `items` in batches. A failed batch is logged and skipped,
 * so one SEPA error doesn't throw away what the other batches fetched.
 */
async function inBatches<I, T>(label: string, items: I[], size: number, fetchBatch: (items: I[]) => Promise<T[]>): Promise<{ results: T[]; failed: number }> {
  const results: T[] = [];
  let failed = 0;
  for (let i = 0; i < items.length; i += size) {
    try {
      results.push(...(await fetchBatch(items.slice(i, i + size))));
    } catch (e) {
      failed++;
      console.error(`${label}: batch ${i / size + 1} failed`, e);
    }
  }
  return { results, failed };
}

export interface PollSummary {
  levels: number;
  empty: number;
  written: number;
  failedBatches: number;
  rain: number | null;
}

/**
 * The 15-minute job: latest levels, levels a day ago, SEPA's rising/falling flags and
 * (hourly, or when the UK day changes) rain, fetched together; outlooks recomputed;
 * then one UPDATE per gauge whose values actually changed.
 */
export async function pollReadings(db: D1Database, now = new Date()): Promise<PollSummary> {
  const { results: rows } = await db
    .prepare(
      `SELECT station_no, ts_id, rf_ts_id, lat, lon, level, level_at, level_hour_ago, level_day_ago, level_day_ago_at,
              trend_sepa, trend_sepa_at, forecast_model, rain, outlook FROM gauges`,
    )
    .all<GaugePollRow>();

  const byTs = new Map(rows.map((r) => [r.ts_id, r.station_no]));
  const byRfTs = new Map(rows.filter((r) => r.rf_ts_id).map((r) => [r.rf_ts_id!, r.station_no]));
  const rainDue = rows.filter((r) => r.forecast_model && rainIsDue(r.rain, now));
  const dayAgoAt = now.getTime() - 24 * 3_600_000;
  const dayFrom = new Date(dayAgoAt - 30 * 60_000).toISOString();
  const dayTo = new Date(dayAgoAt).toISOString();
  // The level a day ago only moves the outlook a little, and dayChange accepts 22-26 h: refetch it
  // about hourly per gauge rather than every poll, to spare SEPA credits.
  const dayAgoDue = rows.filter((r) => !r.level_day_ago_at || dayAgoAt - Date.parse(r.level_day_ago_at) > DAY_AGO_REFRESH_MS).map((r) => r.ts_id);

  const [levelRes, dayRes, flagRes, rainRes] = await Promise.all([
    // Two hours is enough to find the latest reading (SEPA lags up to ~45 min) and the one an hour before it.
    inBatches('SEPA levels', [...byTs.keys()], BATCH, (ids) => fetchSeriesValues(ids, 'PT2H')),
    inBatches('SEPA level a day ago', dayAgoDue, BATCH, (ids) => fetchSeriesWindow(ids, dayFrom, dayTo)),
    inBatches('SEPA rising/falling', [...byRfTs.keys()], BATCH, (ids) => fetchSeriesValues(ids, 'PT1H')),
    rainDue.length ? inBatches('Open-Meteo rain', rainDue, RAIN_BATCH, (gauges) => fetchRain(gauges, now)) : Promise.resolve(null),
  ]);

  const fetched: PollFetched = { levels: new Map(), dayAgo: new Map(), flags: new Map(), rain: new Map() };
  let empty = 0;
  for (const s of levelRes.results) {
    const station = byTs.get(s.ts_id);
    if (!station) continue;
    const { latest, hourAgo } = latestAndHourAgo(s.points);
    if (!latest) empty++;
    else fetched.levels.set(station, { level: latest[1], at: latest[0], hourAgo });
  }
  for (const s of dayRes.results) {
    const last = s.points[s.points.length - 1];
    const station = byTs.get(s.ts_id);
    if (last && station) fetched.dayAgo.set(station, { level: last[1], at: last[0] });
  }
  for (const s of flagRes.results) {
    const last = s.points[s.points.length - 1];
    const station = byRfTs.get(s.ts_id);
    if (last && station) fetched.flags.set(station, { flag: Math.sign(last[1]), at: last[0] });
  }
  for (const [station, rain] of rainRes?.results ?? []) fetched.rain.set(station, rain);

  const stmts: D1PreparedStatement[] = [];
  for (const row of rows) {
    const n = nextGaugeState(row, fetched, now);
    if (!n) continue;
    stmts.push(
      db
        .prepare(
          `UPDATE gauges SET level = ?, level_at = ?, level_hour_ago = ?, level_day_ago = ?, level_day_ago_at = ?,
                  trend_sepa = ?, trend_sepa_at = ?, rain = ?, outlook = ? WHERE station_no = ?`,
        )
        .bind(n.level, n.level_at, n.level_hour_ago, n.level_day_ago, n.level_day_ago_at, n.trend_sepa, n.trend_sepa_at, n.rain, n.outlook, row.station_no),
    );
  }
  if (stmts.length) await db.batch(stmts);

  return {
    levels: fetched.levels.size,
    empty,
    written: stmts.length,
    failedBatches: levelRes.failed + dayRes.failed + flagRes.failed + (rainRes?.failed ?? 0),
    rain: rainRes ? fetched.rain.size : null,
  };
}

export async function refreshRisingFallingIds(db: D1Database): Promise<number> {
  const ids = await fetchRisingFallingIds();
  const stmts = [...ids].map(([station, ts]) => db.prepare('UPDATE gauges SET rf_ts_id = ? WHERE station_no = ?').bind(ts, station));
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

export async function refreshGaugeMetadata(db: D1Database): Promise<number> {
  const stations = await fetchLevelStations();
  const stmts = stations.map((s) =>
    db
      .prepare(
        `INSERT INTO gauges (station_no, name, river, catchment, lat, lon, ts_id, typical_low, typical_high)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(station_no) DO UPDATE SET name = excluded.name, river = excluded.river,
           catchment = excluded.catchment, lat = excluded.lat, lon = excluded.lon, ts_id = excluded.ts_id,
           typical_low = excluded.typical_low, typical_high = excluded.typical_high`,
      )
      .bind(s.station_no, s.name, s.river, s.catchment, s.lat, s.lon, s.ts_id, s.typical_low, s.typical_high),
  );
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

export const HISTORY_PERIODS = ['P1D', 'P2D', 'P7D', 'P30D'] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

/** Level history for one gauge, edge-cached for 15 minutes. Long periods are thinned to ≤ 400 points. */
export async function levelHistory(stationNo: string, tsId: string, period: HistoryPeriod, ctx: ExecutionContext): Promise<LevelHistory> {
  const key = new Request(`https://cache.riverguide/history/${tsId}/${period}`);
  const cached = await caches.default.match(key);
  if (cached) return (await cached.json()) as LevelHistory;

  const [series] = await fetchSeriesValues([tsId], period);
  const pts = series?.points ?? [];
  const step = Math.max(1, Math.ceil(pts.length / 400));
  const thinned = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const history: LevelHistory = { station_no: stationNo, period, points: thinned.map(([t, v]) => ({ t, v })) };

  ctx.waitUntil(
    caches.default.put(key, new Response(JSON.stringify(history), { headers: { 'cache-control': 'public, max-age=900' } })),
  );
  return history;
}

/**
 * Daily rainfall around now (yesterday, today, tomorrow, the day after) for up to
 * 50 gauges, from one Open-Meteo multi-location request. Feeds the level outlook.
 */
async function fetchRain(gauges: Array<{ station_no: string; lat: number; lon: number }>, now: Date): Promise<Array<[string, StoredRain]>> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${gauges.map((g) => g.lat.toFixed(3)).join(',')}` +
    `&longitude=${gauges.map((g) => g.lon.toFixed(3)).join(',')}&daily=precipitation_sum&past_days=1&forecast_days=3&timezone=Europe%2FLondon`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const body = (await res.json()) as unknown;
  const locs = (Array.isArray(body) ? body : [body]) as Array<{ daily?: { time: string[]; precipitation_sum: Array<number | null> } }>;
  const at = now.toISOString();
  const out: Array<[string, StoredRain]> = [];
  locs.forEach((loc, j) => {
    const d = loc.daily;
    if (!d || d.time.length < 4 || !gauges[j]) return;
    const p = d.precipitation_sum.map((v) => v ?? 0);
    out.push([gauges[j].station_no, { day: d.time[1], yesterday: p[0], today: p[1], tomorrow: p[2], dayAfter: p[3], at }]);
  });
  return out;
}
