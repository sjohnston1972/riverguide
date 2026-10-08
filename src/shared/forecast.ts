// Level outlook for a gauge: where the daily peak is likely to be tomorrow and
// the day after, given the current level and the rain around now.
//
// Each usable gauge has an "analogue" model built offline by
// scripts/fit-forecast.ts: for a grid of situations (level × rain today ×
// rain tomorrow, and for most gauges also how much the peak changed since the
// day before, so a falling river is told apart from a steady one) it stores
// how much the gauge's daily peak typically changed the next day on the most
// similar past days (median, and 10th/90th percentiles for a likely range).
// At runtime the grid is interpolated, which is cheap enough to run for every
// gauge on each poll.

/** Rain amounts (mm/day) at the grid's rain nodes. */
export const RAIN_NODES = [0, 2, 5, 10, 20, 40];

export interface ForecastModel {
  usable: boolean;
  /** Mean-absolute-error improvement over "tomorrow = today" on held-out days (cross-validated; all days, wet days). */
  skill: number;
  skill_wet: number | null;
  /** Skill on the worst of the held-out blocks (cross-validated fits only). */
  skill_min?: number;
  days: number;
  /** Level nodes (m), ascending. */
  levels?: number[];
  /** Change-since-yesterday nodes (m), ascending. Present when the model uses the trend (grid gains that dimension). */
  deltas?: number[];
  /** Change in daily peak (m) per [level][delta?][rain today][rain tomorrow]: flat arrays of median, p10, p90. */
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

export function gridIndex(li: number, a: number, b: number, di = 0, nd = 1): number {
  return ((li * nd + di) * NR + a) * NR + b;
}

/**
 * Interpolated change (median, p10, p90) for a level, the rain today and tomorrow,
 * and (for models that use it) how much the level changed since the day before.
 */
export function lookupChange(model: ForecastModel, level: number, rainToday: number, rainTomorrow: number, delta = 0): [number, number, number] {
  const levels = model.levels!;
  const deltas = model.deltas ?? [0];
  const nd = deltas.length;
  const [li, lf] = locate(levels, level);
  const [di, df] = nd > 1 ? locate(deltas, delta) : [0, 0];
  const [ai, af] = locate(SQ_RAIN, Math.sqrt(Math.max(0, rainToday)));
  const [bi, bf] = locate(SQ_RAIN, Math.sqrt(Math.max(0, rainTomorrow)));
  const out: [number, number, number] = [0, 0, 0];
  const tables = [model.med!, model.p10!, model.p90!];
  for (let dl = 0; dl < 2; dl++) {
    for (let dd = 0; dd < (nd > 1 ? 2 : 1); dd++) {
      for (let da = 0; da < 2; da++) {
        for (let db = 0; db < 2; db++) {
          const w = (dl ? lf : 1 - lf) * (nd > 1 ? (dd ? df : 1 - df) : 1) * (da ? af : 1 - af) * (db ? bf : 1 - bf);
          if (w === 0) continue;
          const idx = gridIndex(Math.min(li + dl, levels.length - 1), Math.min(ai + da, NR - 1), Math.min(bi + db, NR - 1), Math.min(di + dd, nd - 1), nd);
          for (let t = 0; t < 3; t++) out[t] += w * tables[t][idx];
        }
      }
    }
  }
  return out;
}

/**
 * Predicted daily peak tomorrow and the day after, with likely ranges. Levels never go below 0.
 * `delta`: change in level over the last 24 hours (used by models that take the trend into account).
 */
export function predictLevels(model: ForecastModel, current: number, rain: DailyRain, delta = 0): LevelOutlook {
  // Floor at the gauge's lowest modelled level (or the current one, if lower): some gauges read below 0 m at base flow.
  const floor = Math.min(current, model.levels![0]);
  const f = (v: number) => r3(Math.max(floor, v));
  const [m1, lo1, hi1] = lookupChange(model, current, rain.today, rain.tomorrow, delta);
  const t1 = Math.max(floor, current + m1);
  const [m2, lo2, hi2] = lookupChange(model, t1, rain.tomorrow, rain.dayAfter, t1 - current);
  const t2 = Math.max(floor, t1 + m2);
  return {
    tomorrow: { level: r3(t1), lo: f(current + lo1), hi: f(current + hi1) },
    // The day after compounds tomorrow's uncertainty.
    dayAfter: { level: r3(t2), lo: f(current + lo1 + lo2), hi: f(current + hi1 + hi2) },
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

// ---- Building a model (scripts/fit-forecast.ts) ----

/** One past day at a gauge: daily peak level, the next day's peak, rain that day and the next, change since the day before. */
export interface AnalogueDay {
  d: number;
  next: number;
  p0: number;
  p1: number;
  dd: number;
}

export interface GridOptions {
  /** Number of most similar past days per grid cell. */
  k: number;
  levelNodes: number;
  deltaQuantiles: number[];
  withTrend: boolean;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** Nearest-rank quantile of an ascending array. */
const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** Strictly increasing nodes at the given quantiles of the values. */
export function nodesAt(values: number[], qs: number[]): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out = qs.map((q) => r4(pct(v, q)));
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = r4(out[i - 1] + 0.001);
  return out;
}

/**
 * The analogue grid: for each node (level, rain today, rain tomorrow, and optionally the change
 * since yesterday), the median and 10th/90th percentile next-day change over the `k` most
 * similar days in `lib`.
 */
export function buildAnalogueGrid(lib: AnalogueDay[], o: GridOptions): Pick<ForecastModel, 'levels' | 'deltas' | 'med' | 'p10' | 'p90'> {
  const ds = lib.map((r) => r.d).sort((a, b) => a - b);
  const spread = Math.max(0.05, pct(ds, 0.95) - pct(ds, 0.05));
  const lvl = nodesAt(ds, Array.from({ length: o.levelNodes }, (_, i) => 0.02 + (0.96 * i) / (o.levelNodes - 1)));
  const dds = lib.map((r) => r.dd).sort((a, b) => a - b);
  const dSpread = Math.max(0.02, pct(dds, 0.95) - pct(dds, 0.05));
  const deltas = o.withTrend ? nodesAt(dds, o.deltaQuantiles) : [0];
  const nd = deltas.length;
  const n = o.levelNodes * nd * NR * NR;
  const med = Array(n).fill(0);
  const p10 = Array(n).fill(0);
  const p90 = Array(n).fill(0);
  const scored = lib.map((t) => ({ t, s: 0 }));
  lvl.forEach((L, li) =>
    deltas.forEach((dn, di) =>
      RAIN_NODES.forEach((a, ai) =>
        RAIN_NODES.forEach((b, bi) => {
          for (const x of scored) {
            const t = x.t;
            x.s =
              ((t.d - L) / spread) ** 2 +
              ((Math.sqrt(t.p1) - Math.sqrt(b)) / 2) ** 2 +
              ((Math.sqrt(t.p0) - Math.sqrt(a)) / 3) ** 2 +
              (o.withTrend ? ((t.dd - dn) / dSpread) ** 2 : 0);
          }
          const near = scored
            .slice()
            .sort((x, y) => x.s - y.s)
            .slice(0, o.k)
            .map((x) => x.t.next - x.t.d)
            .sort((x, y) => x - y);
          const idx = gridIndex(li, ai, bi, di, nd);
          med[idx] = r4(pct(near, 0.5));
          p10[idx] = r4(pct(near, 0.1));
          p90[idx] = r4(pct(near, 0.9));
        }),
      ),
    ),
  );
  return o.withTrend ? { levels: lvl, deltas, med, p10, p90 } : { levels: lvl, med, p10, p90 };
}
