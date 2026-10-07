// Builds a level-outlook model per SEPA gauge -> data/gauge-forecast.json
//
// Method: analogues. For a situation (today's daily peak level, rain today,
// rain tomorrow), find the 25 most similar past days at that gauge and look at
// how much the daily peak changed the next day: the median is the prediction,
// the 10th-90th percentiles the likely range. To keep the Worker cheap, this is
// pre-computed on a grid (8 levels x 6 x 6 rain amounts) and interpolated.
//
// Each gauge is also tried with a fourth input, the change in daily peak since
// the day before (5 nodes), so a river that is draining away is told apart
// from one sitting at the same level. That version is kept only where it
// scores better than the three-input one on the same test days.
//
// Tried and dropped (2026-10-07): rain today from the nearest SEPA rain gauges
// (alone or blended with Open-Meteo). Per-gauge skill moved by noise only
// (better by >0.05 on 14 gauges, worse on 13; median change 0), so the rain
// input stays Open-Meteo.
//
// Data: three years of SEPA daily maximum levels and daily rainfall at the
// gauge (Open-Meteo archive), both cached in data/private/.
// Testing: the grid is built from all but the last 180 days and scored on those
// 180 days against persistence ("tomorrow = today"). Only gauges that beat it
// by MIN_SKILL get numeric predictions on the site; the deployed grid is then
// rebuilt from all days.
//
// Usage: npm run data:forecast   (add -- --refresh to re-download levels)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type ForecastModel, gridIndex, lookupChange, RAIN_NODES } from '../src/shared/forecast.ts';
import { fetchSeriesValues, parseTable, type SepaStation } from '../src/shared/sepa.ts';

const KIWIS = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0';
const TEST_DAYS = 180;
const MIN_DAYS = 400;
const MIN_SKILL = 0.15;
const K = 25;
const LEVEL_NODES = 8;
const DELTA_QUANTILES = [0.03, 0.2, 0.5, 0.8, 0.97];
/** The trend version must beat the plain one by this much skill to be used. */
const TREND_MARGIN = 0.01;
const LEVEL_CACHE = 'data/private/daymax-cache.json';
const RAIN_CACHE = 'data/private/rain-archive.json';

// Only gauges that a river section uses.
const linked = new Set<string>([
  ...(JSON.parse(readFileSync('data/enrichment.json', 'utf8')) as Array<{ links: Array<{ station_no: string }> }>).flatMap((s) => s.links.map((l) => l.station_no)),
  ...(JSON.parse(readFileSync('data/wtw-import.json', 'utf8')) as { bands: Array<{ station_no: string }> }).bands.map((b) => b.station_no),
]);
const gauges = (JSON.parse(readFileSync('data/gauges.json', 'utf8')) as SepaStation[]).filter((g) => linked.has(g.station_no));

// ---- SEPA daily maxima (3 years), cached ----
let levels: Record<string, Record<string, number>> = existsSync(LEVEL_CACHE) && !process.argv.includes('--refresh') ? JSON.parse(readFileSync(LEVEL_CACHE, 'utf8')) : {};
if (!gauges.every((g) => levels[g.station_no] || !g)) {
  const list = parseTable(await (await fetch(`${KIWIS}&request=getTimeseriesList&stationparameter_name=Level&ts_name=Day.Max&returnfields=station_no,ts_id&format=json`)).json());
  const ts = new Map(list.map((r) => [r.station_no, r.ts_id]));
  const todo = gauges.filter((g) => ts.has(g.station_no) && !levels[g.station_no]);
  for (let i = 0; i < todo.length; i += 25) {
    const batch = todo.slice(i, i + 25);
    for (const s of await fetchSeriesValues(batch.map((g) => ts.get(g.station_no)!), 'P3Y')) {
      const g = batch.find((b) => ts.get(b.station_no) === s.ts_id);
      if (g) levels[g.station_no] = Object.fromEntries(s.points.map(([t, v]) => [t.slice(0, 10), v]));
    }
    process.stdout.write(`\rlevels ${Math.min(i + 25, todo.length)}/${todo.length}`);
  }
  writeFileSync(LEVEL_CACHE, JSON.stringify(levels));
  levels = JSON.parse(readFileSync(LEVEL_CACHE, 'utf8'));
}

// ---- Daily rainfall at each gauge (Open-Meteo archive), cached; small batches to respect the free API ----
const end = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
const start = new Date(Date.now() - (3 * 365 + 2) * 86400_000).toISOString().slice(0, 10);
const cachedRain: { rain?: Record<string, Record<string, number>> } = existsSync(RAIN_CACHE) ? JSON.parse(readFileSync(RAIN_CACHE, 'utf8')) : {};
const rain: Record<string, Record<string, number>> = cachedRain.rain ?? {};
const needRain = gauges.filter((g) => !rain[g.station_no]);
for (let i = 0; i < needRain.length; i += 10) {
  const batch = needRain.slice(i, i + 10);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${batch.map((g) => g.lat.toFixed(3)).join(',')}` +
    `&longitude=${batch.map((g) => g.lon.toFixed(3)).join(',')}&start_date=${start}&end_date=${end}&daily=precipitation_sum&timezone=Europe%2FLondon`;
  for (let attempt = 0; ; attempt++) {
    const body = (await (await fetch(url)).json()) as unknown;
    const arr = (Array.isArray(body) ? body : [body]) as Array<{ reason?: string; daily?: { time: string[]; precipitation_sum: Array<number | null> } }>;
    if (arr[0]?.daily) {
      arr.forEach((loc, j) => (rain[batch[j].station_no] = Object.fromEntries(loc.daily!.time.map((t, k) => [t, loc.daily!.precipitation_sum[k] ?? 0]))));
      break;
    }
    if (attempt >= 8) throw new Error(`Open-Meteo archive: ${arr[0]?.reason ?? 'no data'}`);
    await new Promise((r) => setTimeout(r, 65_000));
  }
  writeFileSync(RAIN_CACHE, JSON.stringify({ start, end, rain }));
  process.stdout.write(`\rrain ${Math.min(i + 10, needRain.length)}/${needRain.length}   `);
}

// ---- Analogue model ----
type Day = { d: number; next: number; p0: number; p1: number; dd: number };
const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Strictly increasing nodes at the given quantiles of the values. */
function nodesAt(values: number[], qs: number[]): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out = qs.map((q) => r4(pct(v, q)));
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = r4(out[i - 1] + 0.001);
  return out;
}

function buildGrid(lib: Day[], withTrend: boolean): Pick<ForecastModel, 'levels' | 'deltas' | 'med' | 'p10' | 'p90'> {
  const ds = lib.map((r) => r.d).sort((a, b) => a - b);
  const spread = Math.max(0.05, pct(ds, 0.95) - pct(ds, 0.05));
  const lvl = nodesAt(ds, Array.from({ length: LEVEL_NODES }, (_, i) => 0.02 + (0.96 * i) / (LEVEL_NODES - 1)));
  const dds = lib.map((r) => r.dd).sort((a, b) => a - b);
  const dSpread = Math.max(0.02, pct(dds, 0.95) - pct(dds, 0.05));
  const deltas = withTrend ? nodesAt(dds, DELTA_QUANTILES) : [0];
  const nd = deltas.length;
  const n = LEVEL_NODES * nd * RAIN_NODES.length * RAIN_NODES.length;
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
              (withTrend ? ((t.dd - dn) / dSpread) ** 2 : 0);
          }
          const near = scored
            .slice()
            .sort((x, y) => x.s - y.s)
            .slice(0, K)
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
  return withTrend ? { levels: lvl, deltas, med, p10, p90 } : { levels: lvl, med, p10, p90 };
}

const models: Record<string, ForecastModel | null> = {};
const comparison: Array<{ station: string; name: string; plain: number; trend: number }> = [];
for (const g of gauges) {
  const D = levels[g.station_no];
  const P = rain[g.station_no];
  if (!D || !P) {
    models[g.station_no] = null;
    continue;
  }
  const rows: Day[] = [];
  for (const day of Object.keys(D).sort()) {
    const nx = add(day, 1);
    const pv = add(day, -1);
    if (D[nx] == null || D[pv] == null || P[nx] == null || P[day] == null) continue;
    rows.push({ d: D[day], next: D[nx], p0: P[day], p1: P[nx], dd: D[day] - D[pv] });
  }
  if (rows.length < MIN_DAYS) {
    models[g.station_no] = null;
    continue;
  }
  const train = rows.slice(0, -TEST_DAYS);
  const test = rows.slice(-TEST_DAYS);
  const persist = test.reduce((s, r) => s + Math.abs(r.next - r.d), 0);
  const wet = test.filter((r) => r.p1 >= 5);
  const score = (withTrend: boolean) => {
    const trial: ForecastModel = { usable: true, skill: 0, skill_wet: null, days: rows.length, ...buildGrid(train, withTrend) };
    const predict = (r: Day) => r.d + lookupChange(trial, r.d, r.p0, r.p1, r.dd)[0];
    const skill = persist > 0 ? 1 - test.reduce((s, r) => s + Math.abs(r.next - predict(r)), 0) / persist : 0;
    const skillWet =
      wet.length >= 10 ? 1 - wet.reduce((s, r) => s + Math.abs(r.next - predict(r)), 0) / Math.max(1e-6, wet.reduce((s, r) => s + Math.abs(r.next - r.d), 0)) : null;
    return { skill, skillWet };
  };
  const plain = score(false);
  const trend = score(true);
  const useTrend = trend.skill >= plain.skill + TREND_MARGIN;
  const best = useTrend ? trend : plain;
  comparison.push({ station: g.station_no, name: g.name, plain: plain.skill, trend: trend.skill });
  const usable = best.skill >= MIN_SKILL;
  models[g.station_no] = {
    usable,
    skill: Math.round(best.skill * 1000) / 1000,
    skill_wet: best.skillWet == null ? null : Math.round(best.skillWet * 1000) / 1000,
    days: rows.length,
    ...(usable ? buildGrid(rows, useTrend) : {}),
  };
  process.stdout.write(`\rmodels ${Object.keys(models).length}/${gauges.length}   `);
}

writeFileSync('data/private/forecast-comparison.json', JSON.stringify(comparison, null, 1));
{
  const better = comparison.filter((c) => c.trend >= c.plain + TREND_MARGIN);
  const worse = comparison.filter((c) => c.trend < c.plain - TREND_MARGIN);
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];
  const chosen = comparison.map((c) => (c.trend >= c.plain + TREND_MARGIN ? c.trend : c.plain));
  console.log(
    `\ntrend input: better on ${better.length}, worse on ${worse.length}, about the same on ${comparison.length - better.length - worse.length} of ${comparison.length} gauges; median skill ${med(comparison.map((c) => c.plain)).toFixed(3)} -> ${med(chosen).toFixed(3)}`,
  );
}
writeFileSync('data/gauge-forecast.json', JSON.stringify({ built: new Date().toISOString().slice(0, 10), method: 'analogue grid', k: K, test_days: TEST_DAYS, min_skill: MIN_SKILL, models }) + '\n');
const fitted = Object.values(models).filter(Boolean) as ForecastModel[];
const usable = fitted.filter((m) => m.usable);
const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
console.log(
  `\nmodels: ${fitted.length}/${gauges.length} fitted, ${usable.length} usable (skill >= ${MIN_SKILL}); median skill ${q(fitted.map((m) => m.skill), 0.5).toFixed(2)}; usable median ${q(usable.map((m) => m.skill), 0.5).toFixed(2)}, wet-day median ${q(usable.map((m) => m.skill_wet ?? 0), 0.5).toFixed(2)}`,
);
