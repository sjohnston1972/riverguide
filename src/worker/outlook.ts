// Level outlooks: computed for every gauge with a model on each poll (poll.ts)
// and stored as JSON on the gauge row so page loads stay cheap.

import { type DailyRain, direction, type ForecastModel, predictLevels } from '../shared/forecast.ts';
import { ukToday } from '../shared/status.ts';
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
