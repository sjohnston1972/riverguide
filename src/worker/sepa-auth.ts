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

async function fetchToken(key: string): Promise<string | null> {
  if (cached && Date.now() < cached.expires - REFRESH_MARGIN_MS) return cached.token;
  if (Date.now() < failedUntil) return null;
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
