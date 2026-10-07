// Level outlooks: computed for every gauge with a model after each poll and
// rain refresh, stored as JSON on the gauge row so page loads stay cheap.

import { type DailyRain, direction, type ForecastModel, predictLevels } from '../shared/forecast.ts';
import { dayChange, gaugeTrend, isStale, ukToday } from '../shared/status.ts';
import type { GaugeOutlook, Trend } from '../shared/types.ts';

export interface StoredRain extends DailyRain {
  /** UK date the values refer to as "today". */
  day: string;
  /** When it was fetched (ISO). */
  at: string;
}

/** Rain data older than this is not used for an outlook. */
const RAIN_MAX_AGE_MS = 6 * 3_600_000;

/** `dayChange`: level now minus 24 hours ago (null when unknown; models that use it then assume no change). */
export function computeOutlook(
  level: number,
  trend: Trend,
  model: ForecastModel | null,
  rain: StoredRain | null,
  now = Date.now(),
  dayChange: number | null = null,
): GaugeOutlook | null {
  if (!rain || rain.day !== ukToday(new Date(now)) || now - Date.parse(rain.at) > RAIN_MAX_AGE_MS) return null;
  const base = { rain_today_mm: rain.today, rain_tomorrow_mm: rain.tomorrow, at: new Date(now).toISOString() };
  if (model?.usable && model.levels) {
    const p = predictLevels(model, level, rain, dayChange ?? 0);
    return { basis: 'model', direction: direction(level, p.tomorrow), tomorrow: p.tomorrow, day_after: p.dayAfter, ...base };
  }
  // No trustworthy model: a plain direction from the trend and the rain to come.
  const wet = rain.today + rain.tomorrow;
  const dir: GaugeOutlook['direction'] =
    wet >= 15 || (trend === 'rising' && wet >= 5) ? 'rise' : trend === 'falling' && wet < 5 ? 'fall' : wet < 2 && trend !== 'rising' ? 'fall' : 'steady';
  return { basis: 'trend', direction: dir, tomorrow: null, day_after: null, ...base };
}

const parse = <T>(v: string | null): T | null => {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

export async function updateOutlooks(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare('SELECT station_no, level, level_at, level_hour_ago, level_day_ago, level_day_ago_at, trend_sepa, trend_sepa_at, forecast_model, rain FROM gauges WHERE forecast_model IS NOT NULL')
    .all<{
      station_no: string;
      level: number | null;
      level_at: string | null;
      level_hour_ago: number | null;
      level_day_ago: number | null;
      level_day_ago_at: string | null;
      trend_sepa: number | null;
      trend_sepa_at: string | null;
      forecast_model: string;
      rain: string | null;
    }>();
  const now = Date.now();
  const stmts = results.map((r) => {
    const o =
      r.level == null || isStale(r.level_at, now)
        ? null
        : computeOutlook(
            r.level,
            gaugeTrend(r.level, r.level_hour_ago, r.level_at, r.trend_sepa, r.trend_sepa_at),
            parse<ForecastModel>(r.forecast_model),
            parse<StoredRain>(r.rain),
            now,
            dayChange(r.level, r.level_at, r.level_day_ago, r.level_day_ago_at),
          );
    return db.prepare('UPDATE gauges SET outlook = ? WHERE station_no = ?').bind(o ? JSON.stringify(o) : null, r.station_no);
  });
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}
