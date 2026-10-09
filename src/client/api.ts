// Typed fetch helpers for the Worker API, with small in-memory caches.

import type {
  CommunityReport,
  CommunityReports,
  LevelHistory,
  LoraOverview,
  NewReport,
  PublicConfig,
  RainSeries,
  ReleasesOverview,
  SectionDetail,
  SectionSummary,
  Weather,
} from '../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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

/** URLs whose last response came from the service worker's saved copy (no or very slow connection). */
const offlineUrls = new Set<string>();
/** True when the latest section list is the copy saved on this phone, not a fresh one. */
export const sectionsOffline = () => offlineUrls.has('/api/sections');

async function getJson<T>(url: string, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<T> {
  const res = await fetch(url, { signal, cache, headers: { accept: 'application/json' } });
  if (!res.ok) throw await errorFrom(res);
  if (res.headers.get('x-rg-offline')) offlineUrls.add(url);
  else offlineUrls.delete(url);
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

/** A memoised loader; `.invalidate()` makes the next call fetch again without fetching now. */
function cached<T>(ttlMs: number, load: () => Promise<T>): ((force?: boolean) => Promise<T>) & { invalidate(): void } {
  let c: Cached<T> | null = null;
  const get = (force = false) => {
    if (!force && c && Date.now() - c.at < ttlMs) return c.p;
    const p = load();
    c = { at: Date.now(), p };
    p.catch(() => {
      if (c?.p === p) c = null;
    });
    return p;
  };
  return Object.assign(get, { invalidate: () => void (c = null) });
}

const detailCache = new Map<string, Cached<SectionDetail>>();

export const api = {
  config: cached<PublicConfig>(Infinity, () => getJson('/api/config')),
  // The list page refreshes itself every few minutes; anything that changes a status invalidates this.
  sections: cached<SectionSummary[]>(5 * 60_000, () => getJson('/api/sections')),
  releases: cached<ReleasesOverview>(5 * 60_000, () => getJson('/api/releases')),
  lora: cached<LoraOverview>(15 * 60_000, () => getJson('/api/tides/lora')),

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
  rain(stationNo: string, period: string, signal?: AbortSignal): Promise<RainSeries> {
    return getJson(`/api/gauges/${encodeURIComponent(stationNo)}/rain?period=${encodeURIComponent(period)}`, signal);
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
