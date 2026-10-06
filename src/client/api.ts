// Typed fetch helpers for the Worker API, with small in-memory caches.

import type { LevelHistory, PublicConfig, SectionDetail, SectionSummary, Weather } from '../shared/types.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function errorFrom(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    code = body.error;
    message = body.message || body.error || message;
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, message, code);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

interface Cached<T> {
  at: number;
  p: Promise<T>;
}

function cached<T>(ttlMs: number, load: () => Promise<T>): (force?: boolean) => Promise<T> {
  let c: Cached<T> | null = null;
  return (force = false) => {
    if (!force && c && Date.now() - c.at < ttlMs) return c.p;
    const p = load();
    c = { at: Date.now(), p };
    p.catch(() => {
      if (c?.p === p) c = null;
    });
    return p;
  };
}

const detailCache = new Map<string, Cached<SectionDetail>>();

export const api = {
  config: cached<PublicConfig>(Infinity, () => getJson('/api/config')),
  sections: cached<SectionSummary[]>(60_000, () => getJson('/api/sections')),

  section(slug: string, force = false): Promise<SectionDetail> {
    const hit = detailCache.get(slug);
    if (!force && hit && Date.now() - hit.at < 60_000) return hit.p;
    const p = getJson<SectionDetail>(`/api/sections/${encodeURIComponent(slug)}`);
    detailCache.set(slug, { at: Date.now(), p });
    p.catch(() => detailCache.delete(slug));
    return p;
  },

  history(stationNo: string, period: string, signal?: AbortSignal): Promise<LevelHistory> {
    return getJson(`/api/gauges/${encodeURIComponent(stationNo)}/history?period=${encodeURIComponent(period)}`, signal);
  },

  weather(lat: number, lon: number, signal?: AbortSignal): Promise<Weather> {
    return getJson(`/api/weather?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);
  },
};
