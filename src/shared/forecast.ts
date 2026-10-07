// Level outlook for a gauge: where the daily peak is likely to be tomorrow and
// the day after, given the current level and the rain around now.
//
// Each usable gauge has an "analogue" model built offline by
// scripts/fit-forecast.ts: for a grid of situations (level × rain today ×
// rain tomorrow) it stores how much the gauge's daily peak typically changed
// the next day on the most similar past days (median, and 10th/90th
// percentiles for a likely range). At runtime the grid is interpolated, which
// is cheap enough to run for every gauge on each poll.

/** Rain amounts (mm/day) at the grid's rain nodes. */
export const RAIN_NODES = [0, 2, 5, 10, 20, 40];

export interface ForecastModel {
  usable: boolean;
  /** Mean-absolute-error improvement over "tomorrow = today" on the test period (all days, wet days). */
  skill: number;
  skill_wet: number | null;
  days: number;
  /** Level nodes (m), ascending. */
  levels?: number[];
  /** Change in daily peak (m) per [level][rain today][rain tomorrow]: flat arrays of median, p10, p90. */
  med?: number[];
  p10?: number[];
  p90?: number[];
}

export interface DailyRain {
  /** mm: yesterday, today (observed so far + forecast), tomorrow, the day after. */
  yesterday: number;
  today: number;
  tomorrow: number;
  dayAfter: number;
}

export interface LevelPrediction {
  level: number;
  lo: number;
  hi: number;
}

export interface LevelOutlook {
  tomorrow: LevelPrediction;
  dayAfter: LevelPrediction;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const NR = RAIN_NODES.length;
const SQ_RAIN = RAIN_NODES.map(Math.sqrt);

/** Position of x among ascending nodes as (index, fraction), clamped to the ends. */
function locate(nodes: number[], x: number): [number, number] {
  if (x <= nodes[0]) return [0, 0];
  for (let i = 1; i < nodes.length; i++) {
    if (x <= nodes[i]) return [i - 1, (x - nodes[i - 1]) / (nodes[i] - nodes[i - 1] || 1)];
  }
  return [nodes.length - 2, 1];
}

export function gridIndex(li: number, a: number, b: number): number {
  return (li * NR + a) * NR + b;
}

/** Interpolated change (median, p10, p90) for a level and the rain today and tomorrow. */
export function lookupChange(model: ForecastModel, level: number, rainToday: number, rainTomorrow: number): [number, number, number] {
  const levels = model.levels!;
  const [li, lf] = locate(levels, level);
  const [ai, af] = locate(SQ_RAIN, Math.sqrt(Math.max(0, rainToday)));
  const [bi, bf] = locate(SQ_RAIN, Math.sqrt(Math.max(0, rainTomorrow)));
  const out: [number, number, number] = [0, 0, 0];
  const tables = [model.med!, model.p10!, model.p90!];
  for (let dl = 0; dl < 2; dl++) {
    for (let da = 0; da < 2; da++) {
      for (let db = 0; db < 2; db++) {
        const w = (dl ? lf : 1 - lf) * (da ? af : 1 - af) * (db ? bf : 1 - bf);
        if (w === 0) continue;
        const idx = gridIndex(Math.min(li + dl, levels.length - 1), Math.min(ai + da, NR - 1), Math.min(bi + db, NR - 1));
        for (let t = 0; t < 3; t++) out[t] += w * tables[t][idx];
      }
    }
  }
  return out;
}

/** Predicted daily peak tomorrow and the day after, with likely ranges. Levels never go below 0. */
export function predictLevels(model: ForecastModel, current: number, rain: DailyRain): LevelOutlook {
  const [m1, lo1, hi1] = lookupChange(model, current, rain.today, rain.tomorrow);
  const t1 = Math.max(0, current + m1);
  const [m2, lo2, hi2] = lookupChange(model, t1, rain.tomorrow, rain.dayAfter);
  const t2 = Math.max(0, t1 + m2);
  return {
    tomorrow: { level: r3(t1), lo: r3(Math.max(0, current + lo1)), hi: r3(Math.max(0, current + hi1)) },
    // The day after compounds tomorrow's uncertainty.
    dayAfter: { level: r3(t2), lo: r3(Math.max(0, current + lo1 + lo2)), hi: r3(Math.max(0, current + hi1 + hi2)) },
  };
}

export type Direction = 'rise' | 'fall' | 'steady';

/** Plain direction: a predicted change of more than 10% of the level (at least 3 cm) counts as a rise or drop. */
export function direction(current: number, p: LevelPrediction): Direction {
  const d = p.level - current;
  const threshold = Math.max(0.03, 0.1 * current);
  if (d > threshold || p.lo > current) return 'rise';
  if (d < -threshold || p.hi < current) return 'fall';
  return 'steady';
}
