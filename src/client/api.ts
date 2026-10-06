// Typed fetch helpers for the Worker API, with small in-memory caches.

import type { CommunityReport, CommunityReports, LevelHistory, NewReport, PublicConfig, SectionDetail, SectionSummary, Weather } from '../shared/types.ts';

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

async function getJson<T>(url: string, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<T> {
  const res = await fetch(url, { signal, cache, headers: { accept: 'application/json' } });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

async function send<T>(method: 'POST' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
    const p = getJson<SectionDetail>(`/api/sections/${encodeURIComponent(slug)}`, undefined, force ? 'no-cache' : 'default');
    detailCache.set(slug, { at: Date.now(), p });
    p.catch(() => detailCache.delete(slug));
    return p;
  },

  history(stationNo: string, period: string, signal?: AbortSignal): Promise<LevelHistory> {
    return getJson(`/api/gauges/${encodeURIComponent(stationNo)}/history?period=${encodeURIComponent(period)}`, signal);
  },

  reports(slug: string, signal?: AbortSignal): Promise<CommunityReports> {
    return getJson(`/api/sections/${encodeURIComponent(slug)}/reports`, signal, 'no-store');
  },

  verifyDevice(token: string | null): Promise<{ ok: true }> {
    return send('POST', '/api/community/verify', token ? { token } : {});
  },

  submitReport(slug: string, report: NewReport): Promise<{ report: CommunityReport }> {
    return send('POST', `/api/sections/${encodeURIComponent(slug)}/reports`, report);
  },

  vote(id: string, vote: 1 | -1 | 0): Promise<{ report: CommunityReport }> {
    return send('POST', `/api/reports/${encodeURIComponent(id)}/vote`, { vote });
  },

  flag(id: string): Promise<{ ok: true }> {
    return send('POST', `/api/reports/${encodeURIComponent(id)}/flag`, {});
  },

  deleteReport(id: string): Promise<{ ok: true }> {
    return send('DELETE', `/api/reports/${encodeURIComponent(id)}`);
  },

  weather(lat: number, lon: number, signal?: AbortSignal): Promise<Weather> {
    return getJson(`/api/weather?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);
  },
};
