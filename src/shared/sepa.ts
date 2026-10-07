// SEPA KiWIS client. Uses bulk queries so the whole level network
// (~400 gauges) costs a handful of requests rather than several per gauge.

const KIWIS = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0';

export interface SepaStation {
  station_no: string;
  name: string;
  river: string | null;
  catchment: string | null;
  lat: number;
  lon: number;
  ts_id: string;
  typical_low: number | null;
  typical_high: number | null;
}

export interface SepaSeries {
  ts_id: string;
  points: Array<[string, number]>;
}

/** Optional authentication (SEPA API key -> bearer token). Without it, the public keyless access is used. */
type AuthProvider = () => Promise<Record<string, string>>;
let authHeaders: AuthProvider = async () => ({});
export function setSepaAuth(provider: AuthProvider): void {
  authHeaders = provider;
}

async function getJson(params: string, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(`${KIWIS}&${params}`, { headers: { accept: 'application/json', ...(await authHeaders()) } });
  if (!res.ok) throw new Error(`SEPA ${res.status} for ${params.split('&')[0]}`);
  const body = (await res.json()) as unknown;
  if (body && typeof body === 'object' && !Array.isArray(body) && (body as { type?: string }).type === 'error') {
    throw new Error(`SEPA error: ${(body as { message?: string }).message ?? 'unknown'}`);
  }
  return body;
}

/** KiWIS "json" format: first row is the header, the rest are value rows. */
export function parseTable(raw: unknown): Record<string, string>[] {
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) return [];
  const [header, ...rows] = raw as string[][];
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
}

function num(v: string | undefined | null): number | null {
  if (v == null || v === '' || v === '---') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' || t === '---' || t === '0' ? null : t;
}

/** Every SEPA gauge that publishes a 15-minute level series, with coordinates and typical range. */
export async function fetchLevelStations(fetcher: typeof fetch = fetch): Promise<SepaStation[]> {
  const [series, stations, bands] = await Promise.all([
    getJson('request=getTimeseriesList&stationparameter_name=Level&ts_name=15minute&returnfields=station_no,ts_id&format=json', fetcher),
    getJson('request=getStationList&returnfields=station_no,station_name,river_name,catchment_name,station_latitude,station_longitude&format=json', fetcher),
    getJson(
      'request=getStationList&returnfields=station_no,ca_sta&ca_sta_returnfields=sepa_median_annual_minimum_level,sepa_median_annual_maximum_level&format=objson',
      fetcher,
    ),
  ]);

  const stationByNo = new Map(parseTable(stations).map((s) => [s.station_no, s]));
  const bandsByNo = new Map(
    (Array.isArray(bands) ? (bands as Record<string, string>[]) : []).map((b) => [b.station_no, b]),
  );

  const out: SepaStation[] = [];
  const seen = new Set<string>();
  for (const row of parseTable(series)) {
    const s = stationByNo.get(row.station_no);
    if (!s || seen.has(row.station_no)) continue;
    const lat = num(s.station_latitude);
    const lon = num(s.station_longitude);
    if (lat == null || lon == null) continue;
    seen.add(row.station_no);
    const b = bandsByNo.get(row.station_no);
    out.push({
      station_no: row.station_no,
      name: s.station_name,
      river: text(s.river_name),
      catchment: text(s.catchment_name),
      lat,
      lon,
      ts_id: row.ts_id,
      typical_low: num(b?.sepa_median_annual_minimum_level),
      typical_high: num(b?.sepa_median_annual_maximum_level),
    });
  }
  return out;
}

/** Values for many series in one request. `period` is an ISO-8601 duration such as PT3H or P7D. */
export async function fetchSeriesValues(tsIds: string[], period: string, fetcher: typeof fetch = fetch): Promise<SepaSeries[]> {
  if (tsIds.length === 0) return [];
  if (!/^P(T?\d+[HDMWY])+$/.test(period)) throw new Error(`Bad period ${period}`);
  const raw = await getJson(
    `request=getTimeseriesValues&ts_id=${tsIds.map(encodeURIComponent).join(',')}&period=${period}&returnfields=Timestamp,Value&format=json`,
    fetcher,
  );
  if (!Array.isArray(raw)) return [];
  return (raw as Array<{ ts_id: string; data?: Array<[string, number | null]> }>).map((s) => ({
    ts_id: String(s.ts_id),
    points: (s.data ?? []).filter((p): p is [string, number] => typeof p[1] === 'number' && Number.isFinite(p[1])),
  }));
}

/** Latest value and the value roughly an hour before it. */
export function latestAndHourAgo(points: Array<[string, number]>): { latest: [string, number] | null; hourAgo: number | null } {
  if (points.length === 0) return { latest: null, hourAgo: null };
  const latest = points[points.length - 1];
  const target = Date.parse(latest[0]) - 60 * 60 * 1000;
  let hourAgo: number | null = null;
  for (const [t, v] of points) {
    if (Date.parse(t) <= target) hourAgo = v;
    else break;
  }
  return { latest, hourAgo };
}
