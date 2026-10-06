// Scheduled jobs: latest readings for every gauge (15 min) and gauge metadata (daily).

import { fetchLevelStations, fetchSeriesValues, latestAndHourAgo } from '../shared/sepa.ts';
import type { LevelHistory } from '../shared/types.ts';

const BATCH = 150; // ts_ids per KiWIS request; keeps URLs well under limits

export async function pollReadings(db: D1Database): Promise<{ updated: number; empty: number }> {
  const { results } = await db.prepare('SELECT station_no, ts_id FROM gauges').all<{ station_no: string; ts_id: string }>();
  const byTs = new Map(results.map((r) => [r.ts_id, r.station_no]));
  const ids = [...byTs.keys()];
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let empty = 0;

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
  return { updated: stmts.length, empty };
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
