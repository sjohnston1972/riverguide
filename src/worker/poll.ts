// Scheduled jobs: latest readings for every gauge (15 min) and gauge metadata (daily).

import { fetchLevelStations, fetchRisingFallingIds, fetchSeriesValues, latestAndHourAgo } from '../shared/sepa.ts';
import type { LevelHistory } from '../shared/types.ts';
import { updateOutlooks } from './outlook.ts';

const BATCH = 150; // ts_ids per KiWIS request; keeps URLs well under limits

export async function pollReadings(db: D1Database): Promise<{ updated: number; empty: number }> {
  const { results } = await db.prepare('SELECT station_no, ts_id FROM gauges').all<{ station_no: string; ts_id: string }>();
  const byTs = new Map(results.map((r) => [r.ts_id, r.station_no]));
  const ids = [...byTs.keys()];
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let empty = 0;
  // SEPA's rising/falling flags load alongside the levels (the cron has ~30 s in all).
  const flags = pollRisingFalling(db).catch((e) => console.error('SEPA rising/falling poll failed', e));

  for (let i = 0; i < ids.length; i += BATCH) {
    const series = await fetchSeriesValues(ids.slice(i, i + BATCH), 'PT3H');
    for (const s of series) {
      const { latest, hourAgo } = latestAndHourAgo(s.points);
      const station = byTs.get(s.ts_id);
      if (!station) continue;
      if (!latest) {
        empty++;
        continue;
      }
      stmts.push(
        db
          .prepare('UPDATE gauges SET level = ?, level_at = ?, level_hour_ago = ?, updated_at = ? WHERE station_no = ?')
          .bind(latest[1], latest[0], hourAgo, now, station),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  await flags;
  await updateOutlooks(db);
  return { updated: stmts.length, empty };
}

/** Latest SEPA rising/falling flag for every gauge. Series ids come from the daily metadata refresh. */
async function pollRisingFalling(db: D1Database): Promise<void> {
  const { results } = await db.prepare('SELECT station_no, rf_ts_id FROM gauges WHERE rf_ts_id IS NOT NULL').all<{ station_no: string; rf_ts_id: string }>();
  const byTs = new Map(results.map((r) => [r.rf_ts_id, r.station_no]));
  const ids = [...byTs.keys()];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const s of await fetchSeriesValues(ids.slice(i, i + BATCH), 'PT1H')) {
      const last = s.points[s.points.length - 1];
      const station = byTs.get(s.ts_id);
      if (!last || !station) continue;
      stmts.push(db.prepare('UPDATE gauges SET trend_sepa = ?, trend_sepa_at = ? WHERE station_no = ?').bind(Math.sign(last[1]), last[0], station));
    }
  }
  if (stmts.length) await db.batch(stmts);
}

export async function refreshRisingFallingIds(db: D1Database): Promise<number> {
  const ids = await fetchRisingFallingIds();
  const stmts = [...ids].map(([station, ts]) => db.prepare('UPDATE gauges SET rf_ts_id = ? WHERE station_no = ?').bind(ts, station));
  if (stmts.length) await db.batch(stmts);
  await refreshRisingFallingIds(db).catch((e) => console.error('SEPA rising/falling ids failed', e));
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
 * Daily rainfall around now (yesterday, today, tomorrow, the day after) for
 * every gauge with a forecast model, from Open-Meteo in batched multi-location
 * requests. Feeds the level outlook; run hourly.
 */
export async function refreshRain(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare('SELECT station_no, lat, lon FROM gauges WHERE forecast_model IS NOT NULL')
    .all<{ station_no: string; lat: number; lon: number }>();
  const at = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < results.length; i += 50) {
    const batch = results.slice(i, i + 50);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${batch.map((g) => g.lat.toFixed(3)).join(',')}` +
      `&longitude=${batch.map((g) => g.lon.toFixed(3)).join(',')}&daily=precipitation_sum&past_days=1&forecast_days=3&timezone=Europe%2FLondon`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const body = (await res.json()) as unknown;
    const locs = (Array.isArray(body) ? body : [body]) as Array<{ daily?: { time: string[]; precipitation_sum: Array<number | null> } }>;
    locs.forEach((loc, j) => {
      const d = loc.daily;
      if (!d || d.time.length < 4) return;
      const p = d.precipitation_sum.map((v) => v ?? 0);
      const rain = { day: d.time[1], yesterday: p[0], today: p[1], tomorrow: p[2], dayAfter: p[3], at };
      stmts.push(db.prepare('UPDATE gauges SET rain = ? WHERE station_no = ?').bind(JSON.stringify(rain), batch[j].station_no));
    });
  }
  if (stmts.length) await db.batch(stmts);
  await updateOutlooks(db);
  return stmts.length;
}
