// Community level reports: submit, vote, flag, and derive community bands.

import type { Context, Hono } from 'hono';
import { z } from 'zod/mini';
import { BAND_RULES, type CalibrationPoint, deriveBand, evidenceOf, levelAt, VERDICTS, type Verdict } from '../shared/community.ts';
import { ukToday } from '../shared/status.ts';
import type { CommunityReport, CommunityReports } from '../shared/types.ts';
import { getGauge, getSection } from './data.ts';
import { type AppEnv, flag } from './env.ts';
import { DEVICE_COOKIE, deviceCookie, ipHash, readCookie, signDevice, today, verifyDevice, verifyTurnstile } from './guard.ts';
import { levelHistory } from './poll.ts';

const MAX_REPORTS_PER_IP_PER_DAY = 10;
const LIST_LIMIT = 50;
/** A report with this many "not for me" votes, outnumbering agreements, stops counting. */
const DISPUTED_AT = 3;
/** Notes flagged this many times are hidden. */
const NOTE_HIDDEN_AT = 3;

export const communityEnabled = (env: AppEnv) => flag(env.COMMUNITY_ENABLED) && Boolean(env.SESSION_SECRET);

const NewReportBody = z.object({
  verdict: z.enum(VERDICTS),
  paddled_at: z.iso.datetime({ offset: true }),
  note: z.optional(z.string().check(z.maxLength(1000))),
});
const VoteBody = z.object({ vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });

/** Trim, drop control characters, collapse whitespace, cap length. */
export function cleanNote(note: string | undefined): string | null {
  if (!note) return null;
  const t = note
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
  return t || null;
}

interface PointRow {
  level: number;
  verdict: Verdict;
  ip_hash: string;
  paddled_at: string;
  agrees: number;
  disagrees: number;
}

/** The UK calendar day of an instant: what the paddler picked, not the UTC date (they differ around midnight in BST). */
export const ukDay = (iso: string): string => ukToday(new Date(iso));

async function calibrationPoints(db: D1Database, slug: string, stationNo: string): Promise<CalibrationPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT r.level, r.verdict, r.ip_hash, r.paddled_at,
              COALESCE(SUM(v.vote = 1), 0) AS agrees, COALESCE(SUM(v.vote = -1), 0) AS disagrees
       FROM reports r LEFT JOIN report_votes v ON v.report_id = r.id
       WHERE r.slug = ? AND r.station_no = ? AND r.hidden = 0 AND r.level IS NOT NULL
       GROUP BY r.id`,
    )
    .bind(slug, stationNo)
    .all<PointRow>();
  return results
    .filter((r) => !(r.disagrees >= DISPUTED_AT && r.disagrees > r.agrees))
    .map((r) => ({ level: r.level, verdict: r.verdict, weight: 1 + r.agrees, person: r.ip_hash, day: ukDay(r.paddled_at) }));
}

/** Recompute (or remove) the community band for each gauge a section has reports against. */
export async function recomputeBands(db: D1Database, slug: string): Promise<void> {
  const { results: stations } = await db
    .prepare('SELECT DISTINCT station_no FROM reports WHERE slug = ? AND station_no IS NOT NULL')
    .bind(slug)
    .all<{ station_no: string }>();
  const stmts: D1PreparedStatement[] = [];
  for (const { station_no } of stations) {
    const est = await db
      .prepare(`SELECT min_level, max_level FROM section_gauges WHERE slug = ? AND station_no = ? AND basis != 'manual'`)
      .bind(slug, station_no)
      .first<{ min_level: number | null; max_level: number | null }>();
    const band = deriveBand(await calibrationPoints(db, slug, station_no), { min: est?.min_level ?? null, max: est?.max_level ?? null });
    stmts.push(
      band
        ? db
            .prepare(
              `INSERT INTO community_bands (slug, station_no, min_level, max_level, reports, people, confidence, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(slug, station_no) DO UPDATE SET min_level = excluded.min_level, max_level = excluded.max_level,
                 reports = excluded.reports, people = excluded.people, confidence = excluded.confidence, updated_at = excluded.updated_at`,
            )
            .bind(slug, station_no, band.min_level, band.max_level, band.reports, band.people, band.confidence, new Date().toISOString())
        : db.prepare('DELETE FROM community_bands WHERE slug = ? AND station_no = ?').bind(slug, station_no),
    );
  }
  if (stmts.length) await db.batch(stmts);
}

interface ReportRow {
  id: string;
  slug: string;
  station_no: string | null;
  gauge_name: string | null;
  paddled_at: string;
  level: number | null;
  verdict: Verdict;
  note: string | null;
  note_hidden: number;
  device: string;
  created_at: string;
  agrees: number;
  disagrees: number;
  my_vote: number | null;
}

function toReport(r: ReportRow, device: string | null): CommunityReport {
  return {
    id: r.id,
    station_no: r.station_no,
    gauge_name: r.gauge_name,
    paddled_at: r.paddled_at,
    level: r.level,
    verdict: r.verdict,
    note: r.note_hidden ? null : r.note,
    created_at: r.created_at,
    agrees: r.agrees,
    disagrees: r.disagrees,
    my_vote: r.my_vote ?? 0,
    mine: device != null && r.device === device,
  };
}

async function listReports(db: D1Database, slug: string, device: string | null): Promise<CommunityReport[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, g.name AS gauge_name,
              COALESCE(SUM(v.vote = 1), 0) AS agrees, COALESCE(SUM(v.vote = -1), 0) AS disagrees,
              MAX(CASE WHEN v.device = ?2 THEN v.vote END) AS my_vote
       FROM reports r
       LEFT JOIN report_votes v ON v.report_id = r.id
       LEFT JOIN gauges g ON g.station_no = r.station_no
       WHERE r.slug = ?1 AND r.hidden = 0
       GROUP BY r.id ORDER BY r.paddled_at DESC LIMIT ${LIST_LIMIT}`,
    )
    .bind(slug, device ?? '')
    .all<ReportRow>();
  return results.map((r) => toReport(r, device));
}

async function deviceOf(env: AppEnv, cookieHeader: string | undefined): Promise<string | null> {
  return env.SESSION_SECRET ? verifyDevice(env.SESSION_SECRET, readCookie(cookieHeader ?? null, DEVICE_COOKIE)) : null;
}

const clientIp = (c: Context<{ Bindings: AppEnv }>) => c.req.header('cf-connecting-ip') ?? 'local';

/** Per-IP burst limit shared by every community write (reports, votes, flags, deletes, the bot check). */
async function overLimit(c: Context<{ Bindings: AppEnv }>): Promise<Response | null> {
  if ((await c.env.COMMUNITY_LIMITER.limit({ key: clientIp(c) })).success) return null;
  return c.json({ error: 'rate', message: 'Slow down a little — try again in a minute.' }, 429);
}

export function registerCommunityRoutes(app: Hono<{ Bindings: AppEnv }>): void {
  const disabled = { error: 'disabled', message: 'Community reports are switched off at the moment.' };

  app.get('/api/sections/:slug/reports', async (c) => {
    const slug = c.req.param('slug');
    const found = await getSection(c.env.DB, slug);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const device = await deviceOf(c.env, c.req.header('cookie'));
    const station = found.detail.station_no;
    const [reports, band, points] = await Promise.all([
      listReports(c.env.DB, slug, device),
      station
        ? c.env.DB.prepare('SELECT * FROM community_bands WHERE slug = ? AND station_no = ?').bind(slug, station).first<CommunityReports['band'] & object>()
        : null,
      station ? calibrationPoints(c.env.DB, slug, station) : Promise.resolve([]),
    ]);
    const body: CommunityReports = {
      reports,
      band: band
        ? { station_no: band.station_no, min_level: band.min_level, max_level: band.max_level, reports: band.reports, people: band.people, confidence: band.confidence }
        : null,
      progress: { ...evidenceOf(points), need: { ...BAND_RULES } },
      verified: device != null,
      enabled: communityEnabled(c.env),
    };
    c.header('cache-control', 'no-store');
    return c.json(body);
  });

  // One bot check per device -> long-lived signed device cookie.
  app.post('/api/community/verify', async (c) => {
    if (!communityEnabled(c.env)) return c.json(disabled, 503);
    const limited = await overLimit(c);
    if (limited) return limited;
    const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
    if (c.env.TURNSTILE_SECRET) {
      const ok = typeof token === 'string' && (await verifyTurnstile(c.env.TURNSTILE_SECRET, token, c.req.header('cf-connecting-ip') ?? null));
      if (!ok) return c.json({ error: 'verify', message: 'Verification failed. Please try again.' }, 403);
    }
    c.header('set-cookie', deviceCookie(await signDevice(c.env.SESSION_SECRET!)));
    return c.json({ ok: true });
  });

  app.post('/api/sections/:slug/reports', async (c) => {
    const env = c.env;
    if (!communityEnabled(env)) return c.json(disabled, 503);
    const device = await deviceOf(env, c.req.header('cookie'));
    if (!device) return c.json({ error: 'verify', message: 'Please complete the quick check first.' }, 401);
    const limited = await overLimit(c);
    if (limited) return limited;
    const ip = clientIp(c);
    const parsed = NewReportBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', message: 'Please choose how it was and when you paddled.' }, 400);

    const slug = c.req.param('slug');
    const found = await getSection(env.DB, slug);
    if (!found) return c.json({ error: 'Not found' }, 404);

    const when = Date.parse(parsed.data.paddled_at);
    const now = Date.now();
    if (when > now + 15 * 60_000 || when < now - 7 * 24 * 3_600_000) {
      return c.json({ error: 'bad_request', message: 'Reports can cover the last 7 days.' }, 400);
    }
    const paddledAt = new Date(when).toISOString();
    const ipH = await ipHash(env.SESSION_SECRET!, ip);

    // One report per device per section per UK day. Candidates within a day either side, then compared by UK day.
    const [nearby, todayCount] = await Promise.all([
      env.DB.prepare('SELECT paddled_at FROM reports WHERE slug = ? AND device = ? AND hidden = 0 AND paddled_at BETWEEN ? AND ?')
        .bind(slug, device, new Date(when - 86_400_000).toISOString(), new Date(when + 86_400_000).toISOString())
        .all<{ paddled_at: string }>(),
      env.DB.prepare('SELECT count(*) AS n FROM reports WHERE ip_hash = ? AND created_at >= ?').bind(ipH, today()).first<{ n: number }>(),
    ]);
    const sameDay = nearby.results.some((r) => ukDay(r.paddled_at) === ukDay(paddledAt));
    if (sameDay) return c.json({ error: 'duplicate', message: "You've already reported this section for that day. Delete it first to change it." }, 409);
    if ((todayCount?.n ?? 0) >= MAX_REPORTS_PER_IP_PER_DAY) {
      return c.json({ error: 'quota', message: 'Daily report limit reached. Thanks for contributing — try again tomorrow.' }, 429);
    }

    // Record the headline gauge's level at the time paddled.
    const station = found.detail.station_no;
    let level: number | null = null;
    if (station) {
      const g = await getGauge(env.DB, station);
      if (g) level = levelAt((await levelHistory(g.station_no, g.ts_id, 'P7D', c.executionCtx as ExecutionContext)).points, when);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reports (id, slug, station_no, paddled_at, level, verdict, note, device, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, slug, station, paddledAt, level, parsed.data.verdict, cleanNote(parsed.data.note), device, ipH, new Date().toISOString())
      .run();
    await recomputeBands(env.DB, slug);
    const report = (await listReports(env.DB, slug, device)).find((r) => r.id === id)!;
    return c.json({ report }, 201);
  });

  app.delete('/api/reports/:id', async (c) => {
    if (!communityEnabled(c.env)) return c.json(disabled, 503);
    const limited = await overLimit(c);
    if (limited) return limited;
    const device = await deviceOf(c.env, c.req.header('cookie'));
    const row = await c.env.DB.prepare('SELECT slug, device FROM reports WHERE id = ?').bind(c.req.param('id')).first<{ slug: string; device: string }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!device || row.device !== device) return c.json({ error: 'forbidden', message: 'You can only delete your own reports.' }, 403);
    await c.env.DB.prepare('UPDATE reports SET hidden = 1 WHERE id = ?').bind(c.req.param('id')).run();
    await recomputeBands(c.env.DB, row.slug);
    return c.json({ ok: true });
  });

  app.post('/api/reports/:id/vote', async (c) => {
    if (!communityEnabled(c.env)) return c.json(disabled, 503);
    const device = await deviceOf(c.env, c.req.header('cookie'));
    if (!device) return c.json({ error: 'verify', message: 'Please complete the quick check first.' }, 401);
    const limited = await overLimit(c);
    if (limited) return limited;
    const parsed = VoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid vote.' }, 400);
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT slug, device FROM reports WHERE id = ? AND hidden = 0').bind(id).first<{ slug: string; device: string }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.device === device) return c.json({ error: 'own', message: "You can't vote on your own report." }, 400);
    await (parsed.data.vote === 0
      ? c.env.DB.prepare('DELETE FROM report_votes WHERE report_id = ? AND device = ?').bind(id, device)
      : c.env.DB.prepare(
          `INSERT INTO report_votes (report_id, device, vote, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(report_id, device) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`,
        ).bind(id, device, parsed.data.vote, new Date().toISOString())
    ).run();
    await recomputeBands(c.env.DB, row.slug);
    const report = (await listReports(c.env.DB, row.slug, device)).find((r) => r.id === id);
    return c.json({ report });
  });

  // Report an inappropriate note (the "report content" mechanism).
  app.post('/api/reports/:id/flag', async (c) => {
    if (!communityEnabled(c.env)) return c.json(disabled, 503);
    const device = await deviceOf(c.env, c.req.header('cookie'));
    if (!device) return c.json({ error: 'verify', message: 'Please complete the quick check first.' }, 401);
    const limited = await overLimit(c);
    if (limited) return limited;
    const id = c.req.param('id');
    await c.env.DB.prepare('INSERT OR IGNORE INTO report_flags (report_id, device, created_at) SELECT id, ?, ? FROM reports WHERE id = ?')
      .bind(device, new Date().toISOString(), id)
      .run();
    await c.env.DB.prepare(
      `UPDATE reports SET note_hidden = 1 WHERE id = ? AND (SELECT count(*) FROM report_flags WHERE report_id = ?) >= ${NOTE_HIDDEN_AT}`,
    )
      .bind(id, id)
      .run();
    return c.json({ ok: true });
  });
}
