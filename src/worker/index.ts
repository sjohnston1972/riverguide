import { Hono } from 'hono';
import type { PublicConfig } from '../shared/types.ts';
import { ChatBody, chatStream } from './chat/handler.ts';
import { getGauge, getSection, listSections } from './data.ts';
import { type AppEnv, flag } from './env.ts';
import {
  SESSION_COOKIE,
  ipHash,
  readCookie,
  sessionCookie,
  signSession,
  spendCapMicrodollars,
  spentToday,
  takeDailyQuota,
  verifySession,
  verifyTurnstile,
} from './guard.ts';
import { HISTORY_PERIODS, type HistoryPeriod, levelHistory, pollReadings, refreshGaugeMetadata } from './poll.ts';
import { getWeather } from './weather.ts';

type HonoEnv = { Bindings: AppEnv };
const app = new Hono<HonoEnv>();

const chatEnabled = (env: AppEnv) => Boolean(env.ANTHROPIC_API_KEY && env.SESSION_SECRET);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

app.get('/api/config', (c) => {
  const body: PublicConfig = {
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    chat_enabled: chatEnabled(c.env),
    show_full_guide_text: flag(c.env.SHOW_FULL_GUIDE_TEXT),
  };
  return c.json(body);
});

app.get('/api/sections', async (c) => {
  c.header('cache-control', 'public, max-age=60');
  return c.json(await listSections(c.env.DB));
});

app.get('/api/sections/:slug', async (c) => {
  const found = await getSection(c.env.DB, c.req.param('slug'));
  if (!found) return c.json({ error: 'Not found' }, 404);
  c.header('cache-control', 'public, max-age=60');
  const showGuide = flag(c.env.SHOW_FULL_GUIDE_TEXT) && found.guide;
  return c.json(showGuide ? { ...found.detail, guide: found.guide } : found.detail);
});

app.get('/api/gauges/:no/history', async (c) => {
  const period = (c.req.query('period') ?? 'P2D') as HistoryPeriod;
  if (!HISTORY_PERIODS.includes(period)) return c.json({ error: 'Bad period' }, 400);
  const g = await getGauge(c.env.DB, c.req.param('no'));
  if (!g) return c.json({ error: 'Not found' }, 404);
  c.header('cache-control', 'public, max-age=300');
  return c.json(await levelHistory(g.station_no, g.ts_id, period, c.executionCtx as ExecutionContext));
});

app.get('/api/weather', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 54 || lat > 61.5 || lon < -9 || lon > 0) {
    return c.json({ error: 'lat/lon must be in Scotland' }, 400);
  }
  c.header('cache-control', 'public, max-age=900');
  return c.json(await getWeather(lat, lon, c.executionCtx as ExecutionContext));
});

// Exchange a Turnstile token for a short-lived chat session cookie.
app.post('/api/chat/session', async (c) => {
  if (!chatEnabled(c.env)) return c.json({ error: 'Chat is not available' }, 503);
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
  if (c.env.TURNSTILE_SECRET) {
    const ok = typeof token === 'string' && (await verifyTurnstile(c.env.TURNSTILE_SECRET, token, c.req.header('cf-connecting-ip') ?? null));
    if (!ok) return c.json({ error: 'Verification failed. Please refresh and try again.' }, 403);
  }
  c.header('set-cookie', sessionCookie(await signSession(c.env.SESSION_SECRET!)));
  return c.json({ ok: true });
});

app.post('/api/chat', async (c) => {
  const env = c.env;
  if (!chatEnabled(env)) return c.json({ error: 'Chat is not available' }, 503);
  if (!(await verifySession(env.SESSION_SECRET!, readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE)))) {
    return c.json({ error: 'session', message: 'Chat session expired. Please verify again.' }, 401);
  }

  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const { success } = await env.CHAT_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: 'rate', message: 'Slow down a little — try again in a minute.' }, 429);

  const parsed = ChatBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user') {
    return c.json({ error: 'bad_request', message: 'Invalid chat request.' }, 400);
  }

  if ((await spentToday(env.DB)) >= spendCapMicrodollars(env)) {
    return c.json({ error: 'cap', message: "River Guide's chat has reached today's limit. The river pages still work, and chat will be back tomorrow." }, 503);
  }
  const perIp = Number(env.DAILY_MESSAGES_PER_IP) || 40;
  if (!(await takeDailyQuota(env.DB, await ipHash(env.SESSION_SECRET!, ip), perIp))) {
    return c.json({ error: 'quota', message: `You've reached today's limit of ${perIp} questions. Chat resets at midnight UTC.` }, 429);
  }

  return chatStream(env, c.executionCtx as ExecutionContext, parsed.data);
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === '0 3 * * *') {
      ctx.waitUntil(refreshGaugeMetadata(env.DB).then((n) => console.log(`gauge metadata refreshed: ${n}`)));
      return;
    }
    ctx.waitUntil(pollReadings(env.DB).then((r) => console.log(`poll: ${r.updated} updated, ${r.empty} empty`)));
  },
} satisfies ExportedHandler<AppEnv>;
