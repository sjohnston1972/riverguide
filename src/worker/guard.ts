// Abuse and cost controls for the public chat:
//   1. Turnstile check once -> signed, short-lived chat session cookie
//   2. Workers rate limiter per IP (burst)
//   3. Daily message quota per IP (D1)
//   4. Site-wide daily spend cap (D1), fed by real token usage

import type { AppEnv } from './env.ts';

export const SESSION_COOKIE = 'rg_chat';
const SESSION_TTL_S = 2 * 60 * 60;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = `${nowS + SESSION_TTL_S}.${crypto.randomUUID()}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(secret: string, token: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const exp = Number(payload.split('.')[0]);
  if (!Number.isFinite(exp) || exp < nowS) return false;
  return timingSafeEqual(token.slice(i + 1), await hmac(secret, payload));
}

// Anonymous device identity for community reports: a signed random id in a
// long-lived HttpOnly cookie, issued after one Turnstile check.
export const DEVICE_COOKIE = 'rg_dev';
const DEVICE_TTL_S = 365 * 24 * 60 * 60;

export async function signDevice(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = `${nowS + DEVICE_TTL_S}.${crypto.randomUUID()}`;
  return `${payload}.${await hmac(secret, `dev:${payload}`)}`;
}

/** The device id if the token is valid and unexpired, else null. */
export async function verifyDevice(secret: string, token: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [exp, id, sig] = parts;
  if (!Number.isFinite(Number(exp)) || Number(exp) < nowS) return null;
  return timingSafeEqual(sig, await hmac(secret, `dev:${exp}.${id}`)) ? id : null;
}

export function deviceCookie(token: string): string {
  return `${DEVICE_COOKIE}=${token}; Path=/api; Max-Age=${DEVICE_TTL_S}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/api/chat; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;
}

export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!res.ok) return false;
  const out = (await res.json()) as { success: boolean };
  return out.success === true;
}

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function ipHash(secret: string, ip: string): Promise<string> {
  return (await hmac(secret, `ip:${ip}`)).slice(0, 22);
}

/** Increments today's count for this IP and reports whether it is still within quota. */
export async function takeDailyQuota(db: D1Database, hash: string, limit: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO chat_usage (day, ip_hash, messages) VALUES (?, ?, 1)
       ON CONFLICT(day, ip_hash) DO UPDATE SET messages = messages + 1
       RETURNING messages`,
    )
    .bind(today(), hash)
    .first<{ messages: number }>();
  return (row?.messages ?? 0) <= limit;
}

/** Claude Haiku 4.5 list prices, in microdollars per token. */
const PRICE = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costMicrodollars(u: Usage): number {
  return Math.ceil(
    u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead,
  );
}

export async function spentToday(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT microdollars FROM spend WHERE day = ?').bind(today()).first<{ microdollars: number }>();
  return row?.microdollars ?? 0;
}

export async function recordSpend(db: D1Database, microdollars: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO spend (day, microdollars, requests) VALUES (?, ?, 1)
       ON CONFLICT(day) DO UPDATE SET microdollars = microdollars + excluded.microdollars, requests = requests + 1`,
    )
    .bind(today(), microdollars)
    .run();
}

export function spendCapMicrodollars(env: AppEnv): number {
  const usd = Number(env.DAILY_SPEND_CAP_USD);
  return Math.round((Number.isFinite(usd) && usd > 0 ? usd : 3) * 1e6);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
