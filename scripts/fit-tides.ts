// Fits harmonic tide constants to SEPA's Oban tide gauge (15-minute levels)
// and writes data/oban-tide.json, used for Falls of Lora predictions.
//
//   node scripts/fit-tides.ts            fit on the last 3 years
//   node scripts/fit-tides.ts --check    also fit on all but the last 90 days and
//                                        score high/low water predictions on them
//
// Raw readings are cached in data/private/oban-tide/ (one file per year).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basis, CONSTITUENTS, predict, type TideModel, turningPoints } from '../src/shared/tides.ts';

const TS_ID = '60216010'; // Oban Tidal, 15minute TideLVL
const HW_TS = '60223010'; // HighWater
const LW_TS = '60230010'; // LowWater
const CACHE = 'data/private/oban-tide';
const KIWIS = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&format=json';

type Obs = Array<[number, number]>;

async function fetchSeries(ts: string, from: string, to: string): Promise<Obs> {
  const res = await fetch(`${KIWIS}&ts_id=${ts}&from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`SEPA ${res.status}`);
  const j = (await res.json()) as Array<{ data: Array<[string, number | null]> }>;
  return j[0].data.filter((d): d is [string, number] => d[1] != null).map(([t, v]) => [Date.parse(t), v]);
}

async function year(y: number): Promise<Obs> {
  const file = `${CACHE}/${TS_ID}-${y}.json`;
  const current = y === new Date().getUTCFullYear();
  if (!current && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Obs;
  const obs = await fetchSeries(TS_ID, `${y}-01-01`, `${y}-12-31T23:59:59`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(obs));
  return obs;
}

/** Drops spikes: readings more than 0.5 m from the median of their neighbours. */
function clean(obs: Obs): Obs {
  return obs.filter((o, i) => {
    const near = obs.slice(Math.max(0, i - 4), i + 5).map((x) => x[1]).sort((a, b) => a - b);
    return Math.abs(o[1] - near[near.length >> 1]) < 0.5;
  });
}

function solve(A: number[][], b: number[]): number[] {
  // Gaussian elimination with partial pivoting (the normal matrix is small).
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

function fit(obs: Obs): TideModel {
  const names = CONSTITUENTS.map((c) => c.name);
  const epoch = Date.UTC(2026, 0, 1);
  const n = 1 + 2 * names.length;
  const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const Atb = new Array<number>(n).fill(0);
  // Hourly samples are plenty for constants and keep this quick.
  const hourly = obs.filter(([t]) => t % 3_600_000 === 0);
  for (const [t, v] of hourly) {
    const row = basis(t, epoch, names);
    for (let i = 0; i < n; i++) {
      Atb[i] += row[i] * v;
      const ri = row[i];
      for (let j = i; j < n; j++) AtA[i][j] += ri * row[j];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) AtA[i][j] = AtA[j][i];
  const x = solve(AtA, Atb);
  const model: TideModel = {
    station: 'SEPA 490749 Oban Tidal',
    epoch: new Date(epoch).toISOString(),
    z0: x[0],
    names,
    amp: names.map((_, i) => Math.hypot(x[1 + 2 * i], x[2 + 2 * i])),
    phase: names.map((_, i) => ((Math.atan2(x[2 + 2 * i], x[1 + 2 * i]) * 180) / Math.PI + 360) % 360),
    fitted: { from: new Date(hourly[0][0]).toISOString(), to: new Date(hourly[hourly.length - 1][0]).toISOString(), rms_m: 0 },
  };
  const err = hourly.map(([t, v]) => v - predict(model, t));
  model.fitted.rms_m = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length);
  // Round for a compact file.
  model.z0 = +model.z0.toFixed(4);
  model.amp = model.amp.map((a) => +a.toFixed(4));
  model.phase = model.phase.map((p) => +p.toFixed(2));
  model.fitted.rms_m = +model.fitted.rms_m.toFixed(3);
  return model;
}

const now = Date.now();
const thisYear = new Date(now).getUTCFullYear();
const all: Obs = [];
for (let y = thisYear - 3; y <= thisYear; y++) all.push(...(await year(y)));
const obs = clean(all.filter(([t]) => t >= now - 3 * 365.25 * 86_400_000));
console.log(`${obs.length} readings, ${new Date(obs[0][0]).toISOString().slice(0, 10)} to ${new Date(obs[obs.length - 1][0]).toISOString().slice(0, 10)}`);

if (process.argv.includes('--check')) {
  const cut = now - 90 * 86_400_000;
  const model = fit(obs.filter(([t]) => t < cut - 0)); // fit stops 90 days ago
  const test = obs.filter(([t]) => t >= cut);
  const err = test.map(([t, v]) => v - predict(model, t));
  console.log(`held-out 90 days: rms ${Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length).toFixed(3)} m (fit rms ${model.fitted.rms_m} m)`);
  const from = new Date(cut).toISOString();
  const to = new Date(now).toISOString();
  const observed = [
    ...(await fetchSeries(HW_TS, from, to)).map(([t, v]) => ({ kind: 'high' as const, t, height: v })),
    ...(await fetchSeries(LW_TS, from, to)).map(([t, v]) => ({ kind: 'low' as const, t, height: v })),
  ];
  const predicted = turningPoints(model, cut, now);
  const dt: number[] = [];
  const dh: number[] = [];
  for (const o of observed) {
    const p = predicted.filter((x) => x.kind === o.kind).sort((a, b) => Math.abs(a.t - o.t) - Math.abs(b.t - o.t))[0];
    if (!p || Math.abs(p.t - o.t) > 3 * 3_600_000) continue;
    dt.push((p.t - o.t) / 60_000);
    dh.push(p.height - o.height);
  }
  const q = (a: number[], f: number) => [...a].map(Math.abs).sort((x, y) => x - y)[Math.floor(f * (a.length - 1))];
  console.log(`high/low waters matched: ${dt.length} of ${observed.length}`);
  console.log(`time error (min): median ${q(dt, 0.5).toFixed(0)}, 90% ${q(dt, 0.9).toFixed(0)}  (observed times are on a 15-min grid)`);
  console.log(`height error (m): median ${q(dh, 0.5).toFixed(2)}, 90% ${q(dh, 0.9).toFixed(2)}`);
}

const model = fit(obs);
writeFileSync('data/oban-tide.json', `${JSON.stringify(model)}\n`);
const top = model.names.map((n, i) => [n, model.amp[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`data/oban-tide.json: z0 ${model.z0} m, rms ${model.fitted.rms_m} m; largest ${top.map(([n, a]) => `${n} ${a.toFixed(2)}`).join(', ')}`);
