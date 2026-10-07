// SEPA API key support. SEPA issues short-lived bearer tokens in exchange for
// an API key (sent as HTTP Basic credentials). When SEPA_API_KEY is set, every
// KiWIS call carries a cached token; if the key is missing or the token
// request fails, calls fall back to SEPA's public keyless access.

import { setSepaAuth } from '../shared/sepa.ts';
import type { AppEnv } from './env.ts';

const TOKEN_URL = 'https://timeseries.sepa.org.uk/KiWebPortal/rest/auth/oidcServer/token';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

let cached: { token: string; expires: number } | null = null;
let failedUntil = 0;
let configuredKey: string | undefined;

// Tokens last ~24 h, so share one across Worker instances via the edge cache
// (keyed by a hash of the API key, never the key itself).
async function cacheKey(key: string): Promise<Request> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://cache.riverguide/sepa-token/${hex}`);
}

async function fetchToken(key: string): Promise<string | null> {
  if (cached && Date.now() < cached.expires - REFRESH_MARGIN_MS) return cached.token;
  if (Date.now() < failedUntil) return null;
  const ck = await cacheKey(key);
  const hit = await caches.default.match(ck).catch(() => undefined);
  if (hit) {
    const c = (await hit.json()) as { token: string; expires: number };
    if (Date.now() < c.expires - REFRESH_MARGIN_MS) {
      cached = c;
      return c.token;
    }
  }
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`SEPA token ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('SEPA token response had no access_token');
    cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    const ttl = Math.max(60, Math.floor((cached.expires - Date.now() - REFRESH_MARGIN_MS) / 1000));
    await caches.default
      .put(ck, new Response(JSON.stringify(cached), { headers: { 'cache-control': `max-age=${ttl}` } }))
      .catch(() => undefined);
    return cached.token;
  } catch (err) {
    console.warn('SEPA token unavailable, using keyless access:', (err as Error).message);
    failedUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
    return null;
  }
}

/** Call at the start of each request/scheduled run; cheap and idempotent. */
export function configureSepa(env: AppEnv): void {
  const key = env.SEPA_API_KEY?.trim();
  if (key === configuredKey) return;
  configuredKey = key;
  cached = null;
  failedUntil = 0;
  setSepaAuth(key ? async () => {
    const token = await fetchToken(key);
    return token ? { authorization: `Bearer ${token}` } : {};
  } : async () => ({}));
}
