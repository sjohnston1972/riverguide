// Tide predictions from harmonic constants, and the Falls of Lora ebb windows
// that follow from them. Constants are fitted to SEPA's Oban tide gauge
// (scripts/fit-tides.ts -> data/oban-tide.json); heights are in the gauge's
// datum (chart datum at Oban, judging by the values: low springs ~0.3-0.7 m).

export interface Constituent {
  name: string;
  /** Angular speed, degrees per hour. */
  speed: number;
  /** Nodal correction family (see nodal()). */
  node: NodeFamily;
}

type NodeFamily = 'none' | 'M2' | 'O1' | 'K1' | 'K2' | 'M2^2' | 'M2^3' | 'M2K1' | 'M2^4' | 'Mf' | 'Mm';

/** Standard constituent speeds (deg/h). Enough to resolve a semi-diurnal site with modest shallow-water tides. */
export const CONSTITUENTS: Constituent[] = [
  { name: 'Sa', speed: 0.0410686, node: 'none' },
  { name: 'Ssa', speed: 0.0821373, node: 'none' },
  { name: 'Mm', speed: 0.5443747, node: 'Mm' },
  { name: 'MSf', speed: 1.0158958, node: 'M2' },
  { name: 'Mf', speed: 1.0980331, node: 'Mf' },
  { name: '2Q1', speed: 12.8542862, node: 'O1' },
  { name: 'Q1', speed: 13.3986609, node: 'O1' },
  { name: 'O1', speed: 13.9430356, node: 'O1' },
  { name: 'M1', speed: 14.4966939, node: 'O1' },
  { name: 'P1', speed: 14.9589314, node: 'none' },
  { name: 'S1', speed: 15.0, node: 'none' },
  { name: 'K1', speed: 15.0410686, node: 'K1' },
  { name: 'J1', speed: 15.5854433, node: 'K1' },
  { name: 'OO1', speed: 16.1391017, node: 'K1' },
  { name: '2N2', speed: 27.8953548, node: 'M2' },
  { name: 'MU2', speed: 27.9682084, node: 'M2' },
  { name: 'N2', speed: 28.4397295, node: 'M2' },
  { name: 'NU2', speed: 28.5125831, node: 'M2' },
  { name: 'M2', speed: 28.9841042, node: 'M2' },
  { name: 'LAM2', speed: 29.4556253, node: 'M2' },
  { name: 'L2', speed: 29.5284789, node: 'M2' },
  { name: 'T2', speed: 29.9589333, node: 'none' },
  { name: 'S2', speed: 30.0, node: 'none' },
  { name: 'R2', speed: 30.0410667, node: 'none' },
  { name: 'K2', speed: 30.0821373, node: 'K2' },
  { name: '2SM2', speed: 31.0158958, node: 'M2' },
  { name: 'MO3', speed: 42.9271398, node: 'M2' },
  { name: 'M3', speed: 43.4761563, node: 'M2' },
  { name: 'MK3', speed: 44.0251729, node: 'M2K1' },
  { name: 'MN4', speed: 57.4238337, node: 'M2^2' },
  { name: 'M4', speed: 57.9682084, node: 'M2^2' },
  { name: 'MS4', speed: 58.9841042, node: 'M2' },
  { name: 'MK4', speed: 59.0662415, node: 'M2K1' },
  { name: 'S4', speed: 60.0, node: 'none' },
  { name: '2MN6', speed: 86.4079380, node: 'M2^3' },
  { name: 'M6', speed: 86.9523127, node: 'M2^3' },
  { name: '2MS6', speed: 87.9682084, node: 'M2^2' },
  { name: '2SM6', speed: 88.9841042, node: 'M2' },
  { name: 'M8', speed: 115.9364166, node: 'M2^4' },
];

export interface TideModel {
  station: string;
  /** Epoch for phases (ISO, UTC). */
  epoch: string;
  /** Mean level. */
  z0: number;
  /** Per constituent (same order as `names`): amplitude (m) and phase lag (deg) relative to the epoch, before nodal corrections. */
  names: string[];
  amp: number[];
  phase: number[];
  fitted: { from: string; to: string; rms_m: number };
}

const RAD = Math.PI / 180;

/** Longitude of the Moon's ascending node, degrees, at time t (ms). */
function lunarNode(t: number): number {
  const T = (t - Date.UTC(2000, 0, 1, 12)) / (36525 * 86_400_000);
  return 125.04452 - 1934.136261 * T;
}

/** Nodal amplitude factor f and phase correction u (deg) for a constituent family. */
export function nodal(family: NodeFamily, t: number): { f: number; u: number } {
  const N = lunarNode(t) * RAD;
  const m2 = { f: 1.0004 - 0.0373 * Math.cos(N) + 0.0002 * Math.cos(2 * N), u: -2.14 * Math.sin(N) };
  const k1 = { f: 1.006 + 0.115 * Math.cos(N) - 0.0088 * Math.cos(2 * N), u: -8.86 * Math.sin(N) + 0.68 * Math.sin(2 * N) };
  switch (family) {
    case 'none':
      return { f: 1, u: 0 };
    case 'M2':
      return m2;
    case 'O1':
      return { f: 1.0089 + 0.1871 * Math.cos(N) - 0.0147 * Math.cos(2 * N), u: 10.8 * Math.sin(N) - 1.34 * Math.sin(2 * N) };
    case 'K1':
      return k1;
    case 'K2':
      return { f: 1.0241 + 0.2863 * Math.cos(N) + 0.0083 * Math.cos(2 * N), u: -17.74 * Math.sin(N) + 0.68 * Math.sin(2 * N) };
    case 'Mf':
      return { f: 1.043 + 0.414 * Math.cos(N), u: -23.74 * Math.sin(N) };
    case 'Mm':
      return { f: 1 - 0.13 * Math.cos(N), u: 0 };
    case 'M2^2':
      return { f: m2.f ** 2, u: 2 * m2.u };
    case 'M2^3':
      return { f: m2.f ** 3, u: 3 * m2.u };
    case 'M2^4':
      return { f: m2.f ** 4, u: 4 * m2.u };
    case 'M2K1':
      return { f: m2.f * k1.f, u: m2.u + k1.u };
  }
}

/** Basis functions for one instant: [1, f·cos(θ), f·sin(θ), ...] with θ = speed·hours + u. */
export function basis(t: number, epoch: number, names: readonly string[]): number[] {
  const hours = (t - epoch) / 3_600_000;
  const out = [1];
  for (const name of names) {
    const c = CONSTITUENTS.find((x) => x.name === name)!;
    const { f, u } = nodal(c.node, t);
    const theta = (c.speed * hours + u) * RAD;
    out.push(f * Math.cos(theta), f * Math.sin(theta));
  }
  return out;
}

/**
 * A fast predictor with nodal corrections fixed at `at` (they drift by well
 * under a centimetre a month, so one set serves a window of weeks or months).
 */
export function predictor(model: TideModel, at: number): (t: number) => number {
  const epoch = Date.parse(model.epoch);
  const terms = model.names.map((name, i) => {
    const c = CONSTITUENTS.find((x) => x.name === name)!;
    const { f, u } = nodal(c.node, at);
    return { w: (c.speed * RAD) / 3_600_000, a: f * model.amp[i], p: (u - model.phase[i]) * RAD };
  });
  return (t) => {
    const dt = t - epoch;
    let h = model.z0;
    for (const x of terms) h += x.a * Math.cos(x.w * dt + x.p);
    return h;
  };
}

/** Predicted height (m) at time t (ms, UTC). */
export function predict(model: TideModel, t: number): number {
  return predictor(model, t)(t);
}

export interface TideTurn {
  kind: 'high' | 'low';
  /** UTC ms. */
  t: number;
  height: number;
}

/** High and low waters between two instants, found on a 10-minute grid and refined with a parabola. */
export function turningPoints(model: TideModel, from: number, to: number): TideTurn[] {
  const step = 10 * 60_000;
  const p = predictor(model, (from + to) / 2);
  const out: TideTurn[] = [];
  let a = p(from - step);
  let b = p(from);
  for (let t = from; t <= to; t += step) {
    const c = p(t + step);
    if ((b > a && b >= c) || (b < a && b <= c)) {
      const denom = a - 2 * b + c;
      const off = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const tt = t + off * step;
      out.push({ kind: b > a ? 'high' : 'low', t: Math.round(tt), height: p(tt) });
    }
    a = b;
    b = c;
  }
  return out;
}

// ---- Falls of Lora ----

export const LORA_SLUG = 'falls-of-lora-tidal-rapid';
const CONNEL = { lat: 56.4545, lon: -5.3889 };

/**
 * Ebb timing at the Falls relative to Oban, from fallsoflora.info: the ebb out of
 * Loch Etive starts about 2h10 after high water and reverses about 2h50 after
 * low water; the main wave forms about two hours into the ebb. It works when the
 * Oban range is over 3.2 m and is big over 3.5 m.
 *
 * Those ranges are on the scale of published tide tables. SEPA's Oban gauge
 * records about 8% less range than the tables predict (calibrated against
 * Where's the Water's 2026 Falls dates, which use the tables: 2.96 m on SEPA's
 * scale best matches their 3.2 m), so predicted ranges are scaled by tableScale.
 */
export const LORA = {
  tableScale: 3.2 / 2.96,
  ebbStartAfterHighMin: 130,
  ebbEndAfterLowMin: 170,
  mainWaveAfterEbbStartMin: 120,
  minRange: 3.2,
  bigRange: 3.5,
} as const;

export interface LoraEbb {
  /** UTC ISO times. */
  high_water: string;
  low_water: string;
  ebb_start: string;
  main_wave: string;
  ebb_end: string;
  /** Oban high water minus the following low water, metres, on the tide-table scale. */
  range_m: number;
  size: 'big' | 'working';
  /** Some of the ebb (from the main wave until it reverses) is in daylight. */
  daylight: boolean;
}

/** Working ebbs (Oban range ≥ 3.2 m) between two instants. */
export function loraEbbs(model: TideModel, from: number, to: number): LoraEbb[] {
  // Start a tide early so an ebb already running at `from` is included.
  const turns = turningPoints(model, from - 10 * 3_600_000, to);
  const out: LoraEbb[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const hw = turns[i];
    const lw = turns[i + 1];
    if (hw.kind !== 'high' || lw.kind !== 'low') continue;
    const range = (hw.height - lw.height) * LORA.tableScale;
    if (range < LORA.minRange) continue;
    const start = hw.t + LORA.ebbStartAfterHighMin * 60_000;
    const wave = start + LORA.mainWaveAfterEbbStartMin * 60_000;
    const end = lw.t + LORA.ebbEndAfterLowMin * 60_000;
    if (end < from || start > to) continue;
    const iso = (t: number) => new Date(t).toISOString();
    out.push({
      high_water: iso(hw.t),
      low_water: iso(lw.t),
      ebb_start: iso(start),
      main_wave: iso(wave),
      ebb_end: iso(end),
      range_m: Math.round(range * 100) / 100,
      size: range >= LORA.bigRange ? 'big' : 'working',
      daylight: overlapsDaylight(wave, end),
    });
  }
  return out;
}

function overlapsDaylight(from: number, to: number): boolean {
  for (let t = from; t <= to; t += 15 * 60_000) if (sunAltitude(t, CONNEL.lat, CONNEL.lon) > -0.833) return true;
  return false;
}

/** Solar altitude in degrees (NOAA approximation; good to a few minutes for sunrise/sunset). */
export function sunAltitude(t: number, lat: number, lon: number): number {
  const d = (t - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * RAD - ra);
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}
