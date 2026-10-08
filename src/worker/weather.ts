// Open-Meteo forecast (CC BY 4.0) with the past day's rain, cached 30 minutes per ~1 km cell.

import type { Weather } from '../shared/types.ts';
import { UpstreamError } from '../shared/upstream.ts';

interface OpenMeteo {
  hourly: { time: string[]; temperature_2m: number[]; precipitation: number[]; wind_speed_10m: number[] };
}

const TTL_SECONDS = 30 * 60;

export function summariseWeather(lat: number, lon: number, data: OpenMeteo, now = Date.now()): Weather {
  const h = data.hourly;
  // Open-Meteo returns local times without an offset when timezone=GMT; treat as UTC.
  const times = h.time.map((t) => Date.parse(`${t}:00Z`));
  const sum = (from: number, to: number) =>
    Math.round(times.reduce((acc, t, i) => (t >= from && t < to ? acc + (h.precipitation[i] ?? 0) : acc), 0) * 10) / 10;
  const hourStart = now - (now % 3_600_000);
  const hours = times
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t >= hourStart && t < hourStart + 48 * 3_600_000)
    .map(({ i }) => ({
      time: `${h.time[i]}:00Z`,
      temp_c: h.temperature_2m[i],
      rain_mm: h.precipitation[i],
      wind_kmh: h.wind_speed_10m[i],
    }));
  return {
    lat,
    lon,
    rain_past_24h_mm: sum(hourStart - 24 * 3_600_000, hourStart),
    rain_next_24h_mm: sum(hourStart, hourStart + 24 * 3_600_000),
    rain_next_48h_mm: sum(hourStart, hourStart + 48 * 3_600_000),
    hours,
  };
}

export async function getWeather(latIn: number, lonIn: number, ctx: ExecutionContext): Promise<Weather> {
  const lat = Math.round(latIn * 100) / 100;
  const lon = Math.round(lonIn * 100) / 100;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,precipitation,wind_speed_10m&past_days=1&forecast_days=3&timezone=GMT';

  const cache = caches.default;
  const key = new Request(url);
  let res = await cache.match(key);
  if (!res) {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new UpstreamError('Open-Meteo', `Open-Meteo ${upstream.status}`);
    res = new Response(upstream.body, upstream);
    res.headers.set('cache-control', `public, max-age=${TTL_SECONDS}`);
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return summariseWeather(lat, lon, (await res.json()) as OpenMeteo);
}
