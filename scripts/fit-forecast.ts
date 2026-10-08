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
// from one sitting at the same level. That version is used only where it
// scores better than the three-input one (decided on training days only).
//
// Tried and dropped (2026-10-07): rain today from the nearest SEPA rain gauges
// (alone or blended with Open-Meteo). Per-gauge skill moved by noise only
// (better by >0.05 on 14 gauges, worse on 13; median change 0), so the rain
// input stays Open-Meteo.
//
// Data: three years of SEPA daily maximum levels and daily rainfall at the
// gauge (Open-Meteo archive), both cached in data/private/.
// Testing (nested, blocked cross-validation): the three years are cut into 5
// contiguous blocks and each block is held out in turn, so every season (wet
// winters as well as dry summers) is tested on days the grid hasn't seen.
// Inside each fold the plain-vs-trend choice is made by a 2-block
// cross-validation of that fold's training days only, so the choice never sees
// the test block. Skill is pooled over all held-out days against persistence
// ("tomorrow = today"). A gauge gets numeric predictions on the site only if
// that skill is at least MIN_SKILL, it is no worse than persistence on wet
// days, and no held-out block is worse than persistence; the deployed grid is then rebuilt from all days, with the input the
// folds chose most often.
//
// 2026-10-08: this replaced a single hold-out of the last 180 days. That block
// was the dry season, where persistence is hard to beat, so it understated
// skill (median 0.19 vs 0.27 across all seasons): 56 more gauges qualify, none
// lost, and the trend input survives honest selection on 21 gauges, not 41.
//
// Caveat: the tests use the rain that actually fell. On the site the model is
// fed a rain forecast, so real skill is lower whenever the forecast is wrong.
//
// Usage: npm run data:forecast   (add -- --refresh to re-download levels)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type AnalogueDay, buildAnalogueGrid, type ForecastModel, lookupChange } from '../src/shared/forecast.ts';
import { fetchSeriesValues, parseTable, type SepaStation, KIWIS } from '../src/shared/sepa.ts';

const FOLDS = 5;
const INNER_FOLDS = 2;
/** "Wet" test days: at least this much rain the next day (mm). */
const WET_MM = 5;
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

// ---- Analogue model (grid building and scoring live in src/shared/forecast.ts) ----
const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const GRID = { k: K, levelNodes: LEVEL_NODES, deltaQuantiles: DELTA_QUANTILES };
const buildGrid = (lib: AnalogueDay[], withTrend: boolean) => buildAnalogueGrid(lib, { ...GRID, withTrend });

// ---- Cross-validation ----
/** Contiguous blocks, in date order. */
function blocks<T>(rows: T[], n: number): T[][] {
  const size = Math.ceil(rows.length / n);
  return Array.from({ length: n }, (_, i) => rows.slice(i * size, (i + 1) * size)).filter((b) => b.length > 0);
}

interface Errors {
  model: number;
  persist: number;
  wetModel: number;
  wetPersist: number;
  wetDays: number;
}
const noErrors = (): Errors => ({ model: 0, persist: 0, wetModel: 0, wetPersist: 0, wetDays: 0 });
const sumErrors = (a: Errors, b: Errors): Errors => ({
  model: a.model + b.model,
  persist: a.persist + b.persist,
  wetModel: a.wetModel + b.wetModel,
  wetPersist: a.wetPersist + b.wetPersist,
  wetDays: a.wetDays + b.wetDays,
});
const skillOf = (e: Errors) => (e.persist > 0 ? 1 - e.model / e.persist : 0);
const wetSkillOf = (e: Errors) => (e.wetDays >= 10 && e.wetPersist > 0 ? 1 - e.wetModel / e.wetPersist : null);

/** Absolute errors of a grid built on `train`, and of persistence, over `test`. */
function heldOut(train: AnalogueDay[], test: AnalogueDay[], withTrend: boolean): Errors {
  const m: ForecastModel = { usable: true, skill: 0, skill_wet: null, days: train.length, ...buildGrid(train, withTrend) };
  const e = noErrors();
  for (const r of test) {
    const err = Math.abs(r.next - (r.d + lookupChange(m, r.d, r.p0, r.p1, r.dd)[0]));
    const per = Math.abs(r.next - r.d);
    e.model += err;
    e.persist += per;
    if (r.p1 >= WET_MM) {
      e.wetModel += err;
      e.wetPersist += per;
      e.wetDays++;
    }
  }
  return e;
}

/** Whether the change-since-yesterday input helps, judged only on `train` (blocked CV within it). */
function trendHelps(train: AnalogueDay[]): boolean {
  const inner = blocks(train, INNER_FOLDS);
  let plain = noErrors();
  let trend = noErrors();
  inner.forEach((test, i) => {
    const rest = inner.filter((_, j) => j !== i).flat();
    plain = sumErrors(plain, heldOut(rest, test, false));
    trend = sumErrors(trend, heldOut(rest, test, true));
  });
  return skillOf(trend) >= skillOf(plain) + TREND_MARGIN;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
// The models being replaced, to report what changed.
const previous: Record<string, ForecastModel | null> = existsSync('data/gauge-forecast.json')
  ? (JSON.parse(readFileSync('data/gauge-forecast.json', 'utf8')) as { models: Record<string, ForecastModel | null> }).models
  : {};

const models: Record<string, ForecastModel | null> = {};
const comparison: Array<{ station: string; name: string; skill: number; skill_wet: number | null; skill_min: number; trend_folds: number; usable: boolean; was_usable: boolean | null; was_skill: number | null }> = [];
for (const g of gauges) {
  const D = levels[g.station_no];
  const P = rain[g.station_no];
  if (!D || !P) {
    models[g.station_no] = null;
    continue;
  }
  const rows: AnalogueDay[] = [];
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

  const folds = blocks(rows, FOLDS);
  let pooled = noErrors();
  const foldSkills: number[] = [];
  let trendFolds = 0;
  folds.forEach((test, i) => {
    const train = folds.filter((_, j) => j !== i).flat();
    const useTrend = trendHelps(train);
    if (useTrend) trendFolds++;
    const e = heldOut(train, test, useTrend);
    foldSkills.push(skillOf(e));
    pooled = sumErrors(pooled, e);
  });
  const skill = skillOf(pooled);
  const skillWet = wetSkillOf(pooled);
  // Must beat persistence overall, on wet days, and in every held-out block (no season where it is worse).
  const usable = skill >= MIN_SKILL && (skillWet == null || skillWet >= 0) && Math.min(...foldSkills) >= 0;
  const useTrend = trendFolds > folds.length / 2;
  models[g.station_no] = {
    usable,
    skill: r3(skill),
    skill_wet: skillWet == null ? null : r3(skillWet),
    skill_min: r3(Math.min(...foldSkills)),
    days: rows.length,
    ...(usable ? buildGrid(rows, useTrend) : {}),
  };
  const was = previous[g.station_no];
  comparison.push({
    station: g.station_no,
    name: g.name,
    skill: r3(skill),
    skill_wet: skillWet == null ? null : r3(skillWet),
    skill_min: r3(Math.min(...foldSkills)),
    trend_folds: trendFolds,
    usable,
    was_usable: was ? was.usable : null,
    was_skill: was ? was.skill : null,
  });
  process.stdout.write(`\rmodels ${Object.keys(models).length}/${gauges.length}   `);
}

writeFileSync('data/private/forecast-comparison.json', JSON.stringify(comparison, null, 1));
{
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] ?? NaN;
  const nowUsable = comparison.filter((c) => c.usable);
  const lost = comparison.filter((c) => c.was_usable && !c.usable);
  const gained = comparison.filter((c) => c.was_usable === false && c.usable);
  console.log(
    `\ncross-validated: ${nowUsable.length} usable (was ${comparison.filter((c) => c.was_usable).length}); ` +
      `${lost.length} no longer usable, ${gained.length} newly usable; trend input chosen on ${comparison.filter((c) => c.trend_folds > FOLDS / 2).length}; ` +
      `median skill ${med(comparison.map((c) => c.skill)).toFixed(3)} (old single hold-out ${med(comparison.map((c) => c.was_skill ?? NaN).filter(Number.isFinite)).toFixed(3)})`,
  );
}
// One model per line, so a refit shows which gauges changed instead of one 1.5 MB line.
const meta = JSON.stringify({ built: new Date().toISOString().slice(0, 10), method: 'analogue grid', k: K, validation: `nested blocked CV, ${FOLDS} folds`, min_skill: MIN_SKILL });
const modelLines = Object.entries(models).map(([no, m]) => `${JSON.stringify(no)}:${JSON.stringify(m)}`);
writeFileSync('data/gauge-forecast.json', `${meta.slice(0, -1)},"models":{\n${modelLines.join(',\n')}\n}}\n`);
const fitted = Object.values(models).filter(Boolean) as ForecastModel[];
const usable = fitted.filter((m) => m.usable);
const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
console.log(
  `\nmodels: ${fitted.length}/${gauges.length} fitted, ${usable.length} usable (skill >= ${MIN_SKILL}); median skill ${q(fitted.map((m) => m.skill), 0.5).toFixed(2)}; usable median ${q(usable.map((m) => m.skill), 0.5).toFixed(2)}, wet-day median ${q(usable.map((m) => m.skill_wet ?? 0), 0.5).toFixed(2)}`,
);
