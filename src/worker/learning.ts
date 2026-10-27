// Daily learning job (about 07:15 UK, see index.ts): save every gauge's outlook,
// check earlier ones against the daily peaks SEPA has since published, and
// re-learn each gauge's corrections (the method is in shared/learning.ts).
// About 3 SEPA requests and a few hundred D1 writes a day.

import { type ForecastModel, predictLevels } from '../shared/forecast.ts';
import { parseJson } from '../shared/json.ts';
import { type CheckedDay, learnOutlook, type LearnedOutlook, MIN_TRAIN, WINDOW } from '../shared/learning.ts';
import { fetchDayMaxIds, fetchSeriesValues } from '../shared/sepa.ts';
import { dayChange, isStale, ukToday } from '../shared/status.ts';
import type { GaugeOutlook } from '../shared/types.ts';
import type { StoredRain } from './outlook.ts';

const SEPA_BATCH = 150;
const WRITE_BATCH = 100;
/** Snapshots still missing a peak are rechecked for this many days (SEPA publishes a day's peak 1-2 days later). */
const CHECK_DAYS = 8;

/** A UK date (YYYY-MM-DD) moved by whole days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface SnapshotGaugeRow {
  station_no: string;
  level: number | null;
  level_at: string | null;
  level_day_ago: number | null;
  level_day_ago_at: string | null;
  forecast_model: string | null;
  rain: string | null;
  outlook: string | null;
}

export interface Snapshot {
  station_no: string;
  issued_day: string;
  issued_at: string;
  level_now: number;
  day_change: number | null;
  rain_today: number;
  rain_tomorrow: number;
  rain_day_after: number;
  shown_basis: string | null;
  shown_direction: string | null;
  t1: number | null;
  t1_lo: number | null;
  t1_hi: number | null;
  t2: number | null;
  t2_lo: number | null;
  t2_hi: number | null;
}

/** Today's snapshot for a gauge, or null without a fresh level or today's rain (when there is no outlook either). */
export function snapshotOf(row: SnapshotGaugeRow, now: Date): Snapshot | null {
  const rain = parseJson<StoredRain>(row.rain);
  const today = ukToday(now);
  if (!row.forecast_model || row.level == null || isStale(row.level_at, now.getTime()) || !rain || rain.day !== today) return null;
  const model = parseJson<ForecastModel>(row.forecast_model);
  const dc = dayChange(row.level, row.level_at, row.level_day_ago, row.level_day_ago_at);
  // The raw model, even where the site shows a direction only, so a demoted gauge can show it has recovered.
  const p = model?.usable && model.levels ? predictLevels(model, row.level, rain, dc ?? 0) : null;
  const shown = parseJson<GaugeOutlook>(row.outlook);
  return {
    station_no: row.station_no,
    issued_day: today,
    issued_at: now.toISOString(),
    level_now: row.level,
    day_change: dc == null ? null : Math.round(dc * 1000) / 1000,
    rain_today: rain.today,
    rain_tomorrow: rain.tomorrow,
    rain_day_after: rain.dayAfter,
    shown_basis: shown?.basis ?? null,
    shown_direction: shown?.direction ?? null,
    t1: p?.tomorrow.level ?? null,
    t1_lo: p?.tomorrow.lo ?? null,
    t1_hi: p?.tomorrow.hi ?? null,
    t2: p?.dayAfter.level ?? null,
    t2_lo: p?.dayAfter.lo ?? null,
    t2_hi: p?.dayAfter.hi ?? null,
  };
}

async function inChunks(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += WRITE_BATCH) await db.batch(stmts.slice(i, i + WRITE_BATCH));
}

/** Save today's outlooks (once per day), and record yesterday's rain against the snapshots it belongs to. */
export async function takeSnapshots(db: D1Database, now: Date): Promise<number> {
  const { results } = await db
    .prepare('SELECT station_no, level, level_at, level_day_ago, level_day_ago_at, forecast_model, rain, outlook FROM gauges WHERE forecast_model IS NOT NULL')
    .all<SnapshotGaugeRow>();
  const today = ukToday(now);
  const stmts: D1PreparedStatement[] = [];
  let taken = 0;
  for (const row of results) {
    const s = snapshotOf(row, now);
    if (s) {
      taken++;
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO outlook_snapshots (station_no, issued_day, issued_at, level_now, day_change, rain_today, rain_tomorrow, rain_day_after,
               shown_basis, shown_direction, t1, t1_lo, t1_hi, t2, t2_lo, t2_hi)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(s.station_no, s.issued_day, s.issued_at, s.level_now, s.day_change, s.rain_today, s.rain_tomorrow, s.rain_day_after,
            s.shown_basis, s.shown_direction, s.t1, s.t1_lo, s.t1_hi, s.t2, s.t2_lo, s.t2_hi),
      );
    }
    // This morning's "yesterday" is the rain that fell on the day of yesterday's snapshot and the day after the one before.
    const rain = parseJson<StoredRain>(row.rain);
    if (rain && rain.day === today) {
      stmts.push(
        db.prepare('UPDATE outlook_snapshots SET rain_fell_d0 = ? WHERE station_no = ? AND issued_day = ? AND rain_fell_d0 IS NULL').bind(rain.yesterday, row.station_no, addDays(today, -1)),
        db.prepare('UPDATE outlook_snapshots SET rain_fell_t1 = ? WHERE station_no = ? AND issued_day = ? AND rain_fell_t1 IS NULL').bind(rain.yesterday, row.station_no, addDays(today, -2)),
      );
    }
  }
  await inChunks(db, stmts);
  return taken;
}

interface PendingRow {
  station_no: string;
  issued_day: string;
  actual_d0: number | null;
  actual_t1: number | null;
  actual_t2: number | null;
}

/** Peaks to fill in for a snapshot from a gauge's daily peaks (by date), or null when there is nothing new. */
export function newPeaks(row: PendingRow, peaks: Map<string, number>): [number | null, number | null, number | null] | null {
  const d0 = row.actual_d0 ?? peaks.get(row.issued_day) ?? null;
  const t1 = row.actual_t1 ?? peaks.get(addDays(row.issued_day, 1)) ?? null;
  const t2 = row.actual_t2 ?? peaks.get(addDays(row.issued_day, 2)) ?? null;
  return d0 === row.actual_d0 && t1 === row.actual_t1 && t2 === row.actual_t2 ? null : [d0, t1, t2];
}

/** Fill in the daily peaks SEPA has published for recent snapshots. */
export async function checkSnapshots(db: D1Database, now: Date): Promise<number> {
  const { results: pending } = await db
    .prepare(
      `SELECT station_no, issued_day, actual_d0, actual_t1, actual_t2 FROM outlook_snapshots
       WHERE issued_day >= ? AND (actual_d0 IS NULL OR actual_t1 IS NULL OR actual_t2 IS NULL)`,
    )
    .bind(addDays(ukToday(now), -CHECK_DAYS))
    .all<PendingRow>();
  if (!pending.length) return 0;
  const ids = await fetchDayMaxIds();
  const stations = [...new Set(pending.map((r) => r.station_no))].filter((s) => ids.has(s));
  const byTs = new Map(stations.map((s) => [ids.get(s)!, s]));
  const peaks = new Map<string, Map<string, number>>();
  for (let i = 0; i < stations.length; i += SEPA_BATCH) {
    const series = await fetchSeriesValues(stations.slice(i, i + SEPA_BATCH).map((s) => ids.get(s)!), `P${CHECK_DAYS + 3}D`);
    for (const s of series) {
      const station = byTs.get(s.ts_id);
      // Day.Max is stamped 09:00Z on its day; the date part is the day, as in the data the models were fitted to.
      if (station) peaks.set(station, new Map(s.points.map(([t, v]) => [t.slice(0, 10), v])));
    }
  }
  const stmts: D1PreparedStatement[] = [];
  for (const row of pending) {
    const fill = newPeaks(row, peaks.get(row.station_no) ?? new Map());
    if (fill) {
      stmts.push(
        db.prepare('UPDATE outlook_snapshots SET actual_d0 = ?, actual_t1 = ?, actual_t2 = ? WHERE station_no = ? AND issued_day = ?').bind(...fill, row.station_no, row.issued_day),
      );
    }
  }
  await inChunks(db, stmts);
  return stmts.length;
}

interface CheckedRow {
  station_no: string;
  level_now: number;
  t1: number;
  t1_lo: number;
  t1_hi: number;
  t2: number;
  t2_lo: number;
  t2_hi: number;
  actual_t1: number | null;
  actual_t2: number | null;
}

/** Same corrections and state, ignoring when they were computed. */
const sameLearned = (a: LearnedOutlook | null, b: LearnedOutlook | null) => JSON.stringify(a && { ...a, at: '' }) === JSON.stringify(b && { ...b, at: '' });

/** Re-learn every gauge's corrections from its checked snapshots; writes only the gauges that changed. */
export async function relearn(db: D1Database, now: Date): Promise<number> {
  const since = addDays(ukToday(now), -(WINDOW + MIN_TRAIN + CHECK_DAYS));
  const [{ results: rows }, { results: current }] = await Promise.all([
    db
      .prepare(
        `SELECT station_no, level_now, t1, t1_lo, t1_hi, t2, t2_lo, t2_hi, actual_t1, actual_t2 FROM outlook_snapshots
         WHERE issued_day >= ? AND t1 IS NOT NULL AND (actual_t1 IS NOT NULL OR actual_t2 IS NOT NULL) ORDER BY issued_day`,
      )
      .bind(since)
      .all<CheckedRow>(),
    db.prepare('SELECT station_no, learned FROM gauges WHERE learned IS NOT NULL').all<{ station_no: string; learned: string }>(),
  ]);
  const prev = new Map(current.map((r) => [r.station_no, parseJson<LearnedOutlook>(r.learned)]));
  const byStation = new Map<string, CheckedRow[]>();
  for (const r of rows) byStation.set(r.station_no, [...(byStation.get(r.station_no) ?? []), r]);

  const stmts: D1PreparedStatement[] = [];
  for (const [station, list] of byStation) {
    const tomorrow: CheckedDay[] = list.filter((r) => r.actual_t1 != null).map((r) => ({ now: r.level_now, pred: r.t1, lo: r.t1_lo, hi: r.t1_hi, actual: r.actual_t1! }));
    const dayAfter: CheckedDay[] = list.filter((r) => r.actual_t2 != null).map((r) => ({ now: r.level_now, pred: r.t2, lo: r.t2_lo, hi: r.t2_hi, actual: r.actual_t2! }));
    const old = prev.get(station) ?? null;
    const next = learnOutlook(tomorrow, dayAfter, old?.demoted ?? false, now);
    if (!sameLearned(old, next)) stmts.push(db.prepare('UPDATE gauges SET learned = ? WHERE station_no = ?').bind(JSON.stringify(next), station));
  }
  await inChunks(db, stmts);
  return stmts.length;
}

export async function runDailyLearning(db: D1Database, now = new Date()): Promise<string> {
  const taken = await takeSnapshots(db, now);
  // A SEPA failure only delays the checks to tomorrow; learning still runs on what is already checked.
  const checked = await checkSnapshots(db, now).catch((e) => {
    console.error('outlook check failed', e);
    return 0;
  });
  const learned = await relearn(db, now);
  return `${taken} outlooks saved, ${checked} checked, ${learned} gauges' corrections changed`;
}
