import { Hono } from 'hono';
import { STALE_AFTER_MS } from '../shared/status.ts';
import type { PublicConfig } from '../shared/types.ts';
import { UpstreamError } from '../shared/upstream.ts';
import { getGauge, getSection, listSections } from './data.ts';
import { cachedJson, purgeSections, sectionKey, sectionsKey } from './edgecache.ts';
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
import { HISTORY_PERIODS, type HistoryPeriod, levelHistory, pollReadings, refreshGaugeMetadata, refreshRisingFallingIds } from './poll.ts';
import { communityEnabled, registerCommunityRoutes } from './community.ts';
import { refreshFreshets } from './freshets.ts';
import { loraOverview, releasesOverview } from './schedules.ts';
import { configureSepa } from './sepa-auth.ts';
import { getWeather } from './weather.ts';

type HonoEnv = { Bindings: AppEnv };
const app = new Hono<HonoEnv>();

const chatEnabled = (env: AppEnv) => flag(env.CHAT_ENABLED) && Boolean(env.ANTHROPIC_API_KEY && env.SESSION_SECRET);

app.use('*', async (c, next) => {
  configureSepa(c.env);
  await next();
});

app.onError((err, c) => {
  console.error(err);
  if (err instanceof UpstreamError) {
    return c.json({ error: 'upstream', message: `${err.source} isn't responding just now. Try again in a few minutes.` }, 502);
  }
  return c.json({ error: 'Internal error' }, 500);
});

/** Newest reading older than this means the poll has stopped (SEPA itself usually lags 15-45 minutes). */
const HEALTH_MAX_AGE_MIN = 90;

// For an uptime monitor: 503 when the 15-minute poll has stopped bringing in new readings.
app.get('/api/health', async (c) => {
  const r = await c.env.DB.prepare('SELECT max(level_at) AS latest, sum(level_at >= ?) AS fresh, count(*) AS gauges FROM gauges')
    .bind(new Date(Date.now() - STALE_AFTER_MS).toISOString())
    .first<{ latest: string | null; fresh: number | null; gauges: number }>();
  const age = r?.latest ? Math.round((Date.now() - Date.parse(r.latest)) / 60_000) : null;
  const ok = age != null && age <= HEALTH_MAX_AGE_MIN;
  c.header('cache-control', 'no-store');
  return c.json({ ok, latest_level_at: r?.latest ?? null, age_minutes: age, gauges_fresh: r?.fresh ?? 0, gauges: r?.gauges ?? 0 }, ok ? 200 : 503);
});

app.get('/api/config', (c) => {
  const body: PublicConfig = {
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    chat_enabled: chatEnabled(c.env),
    community_enabled: communityEnabled(c.env),
    show_full_guide_text: flag(c.env.SHOW_FULL_GUIDE_TEXT),
  };
  return c.json(body);
});

// Section list and pages: edge-cached and purged when a poll, a community report or the release schedule
// changes them; browsers always revalidate (ETag), since statuses can change at any of those moments.
app.get('/api/sections', async (c) => {
  return (await cachedJson(c.req.raw, sectionsKey(), 300, c.executionCtx as ExecutionContext, () => listSections(c.env.DB)))!;
});

app.get('/api/releases', async (c) => {
  c.header('cache-control', 'public, max-age=300');
  return c.json(await releasesOverview(c.env.DB));
});

app.get('/api/tides/lora', (c) => {
  c.header('cache-control', 'public, max-age=900');
  return c.json(loraOverview(60));
});

app.get('/api/sections/:slug', async (c) => {
  const slug = c.req.param('slug');
  // Not purged after each poll (one key per section), so a shorter TTL.
  const res = await cachedJson(c.req.raw, sectionKey(slug), 120, c.executionCtx as ExecutionContext, async () => {
    const found = await getSection(c.env.DB, slug);
    if (!found) return null;
    const showGuide = flag(c.env.SHOW_FULL_GUIDE_TEXT) && found.guide;
    return showGuide ? { ...found.detail, guide: found.guide } : found.detail;
  });
  return res ?? c.json({ error: 'Not found' }, 404);
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

  // Loaded on demand: the chat module pulls in the Anthropic SDK (most of the bundle), unused while chat is off.
  const { ChatBody, chatStream } = await import('./chat/handler.ts');
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

registerCommunityRoutes(app);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    configureSepa(env);
    if (event.cron === '0 3 * * *') {
      // Metadata first, so gauges new to SEPA also get their rising/falling series id.
      ctx.waitUntil(
        (async () => {
          console.log(`gauge metadata refreshed: ${await refreshGaugeMetadata(env.DB)}`);
          console.log(`SEPA rising/falling ids refreshed: ${await refreshRisingFallingIds(env.DB)}`);
        })().catch((e) => console.error('gauge metadata refresh failed', e)),
      );
      ctx.waitUntil(
        refreshFreshets(env.DB).then(
          async (n) => {
            console.log(`dam releases refreshed: ${n}`);
            await purgeSections();
          },
          (e) => console.error('dam releases refresh failed', e),
        ),
      );
      return;
    }
    // First run after deploy (or a wiped table): load dam releases without waiting for 03:00.
    ctx.waitUntil(
      (async () => {
        if (await env.DB.prepare('SELECT 1 FROM freshets LIMIT 1').first()) return;
        console.log(`dam releases loaded: ${await refreshFreshets(env.DB)}`);
      })().catch((e) => console.error('dam releases load failed', e)),
    );
    // Levels, trends and (hourly, or after UK midnight) rain, then outlooks, in one pass.
    ctx.waitUntil(
      pollReadings(env.DB).then(
        async (r) => {
          if (r.written) await purgeSections();
          console.log(
            `poll: ${r.levels} levels, ${r.empty} empty, ${r.written} rows written` +
              (r.rain == null ? '' : `, rain for ${r.rain}`) +
              (r.failedBatches ? `, ${r.failedBatches} batches FAILED` : ''),
          );
        },
        (e) => console.error('poll failed', e),
      ),
    );
  },
} satisfies ExportedHandler<AppEnv>;
