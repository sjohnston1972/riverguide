// Feedback and bug reports from the About page, raised as issues in a private GitHub repo
// (FEEDBACK_REPO) for the maintainer to review. Needs the GITHUB_FEEDBACK_TOKEN secret: a
// fine-grained token with Issues read/write on that repo only.

import type { Hono } from 'hono';
import { z } from 'zod/mini';
import { FEEDBACK_KINDS, type FeedbackKind } from '../shared/feedback.ts';
import type { AppEnv } from './env.ts';
import { ipHash, verifyTurnstile } from './guard.ts';

export const MAX_FEEDBACK_LENGTH = 4000;

export const feedbackEnabled = (env: AppEnv) => Boolean(env.GITHUB_FEEDBACK_TOKEN && env.FEEDBACK_REPO);

const FeedbackBody = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().check(z.maxLength(MAX_FEEDBACK_LENGTH * 2)),
  email: z.optional(z.string().check(z.maxLength(200))),
  page: z.optional(z.string().check(z.maxLength(300))),
  screen: z.optional(z.string().check(z.maxLength(40))),
  token: z.optional(z.string().check(z.maxLength(4096))),
});

const LABELS: Record<FeedbackKind, string> = { bug: 'bug', idea: 'idea', other: 'feedback' };
const KIND_NAME: Record<FeedbackKind, string> = { bug: 'Bug', idea: 'Idea', other: 'Feedback' };

/** Keep line breaks, drop other control characters, trim, cap length. */
export function cleanMessage(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_FEEDBACK_LENGTH);
}

/** Stop "@name" in user text from notifying a GitHub user. */
const unmention = (s: string) => s.replace(/@(?=[A-Za-z0-9])/g, '@\u200b');

/** One table cell: no line breaks or pipes. */
const cell = (s: string) => unmention(s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()) || '—';

/** No backticks or pipes either, so it can sit in a code span (which GitHub never treats as a mention). */
export const validEmail = (s: string) => /^[^\s@`|]+@[^\s@`|]+\.[^\s@`|]+$/.test(s);

export interface FeedbackIssueInput {
  kind: FeedbackKind;
  message: string;
  email?: string | null;
  page?: string | null;
  screen?: string | null;
  userAgent?: string | null;
  sender?: string | null;
  sentAt: Date;
}

export function feedbackIssue(f: FeedbackIssueInput): { title: string; body: string; labels: string[] } {
  const firstLine = f.message.split('\n')[0].replace(/\s+/g, ' ').trim();
  const summary = firstLine.length > 70 ? `${firstLine.slice(0, 69).trimEnd()}…` : firstLine;
  const rows: [string, string | null | undefined][] = [
    ['Type', KIND_NAME[f.kind]],
    ['Page', f.page],
    ['Screen', f.screen],
    ['Browser', f.userAgent?.slice(0, 250)],
    ['Sender', f.sender],
    ['Sent', f.sentAt.toISOString()],
  ];
  const body = [
    unmention(f.message),
    '',
    '---',
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${cell(v ?? '')} |`),
    // Left intact (no zero-width space) so it can be copied to reply.
    `| Reply to | ${f.email ? `\`${f.email}\`` : '—'} |`,
    '',
    '<sub>Sent from the River Guide feedback form. "Sender" is a hashed IP, the same for repeat messages from one connection.</sub>',
  ].join('\n');
  return { title: `${KIND_NAME[f.kind]}: ${unmention(summary)}`, body, labels: [LABELS[f.kind], 'from-site'] };
}

export function registerFeedbackRoutes(app: Hono<{ Bindings: AppEnv }>): void {
  app.post('/api/feedback', async (c) => {
    const env = c.env;
    if (!feedbackEnabled(env)) return c.json({ error: 'disabled', message: 'Feedback is switched off at the moment.' }, 503);
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    if (!(await env.COMMUNITY_LIMITER.limit({ key: `feedback:${ip}` })).success) {
      return c.json({ error: 'rate', message: 'Slow down a little — try again in a minute.' }, 429);
    }
    const parsed = FeedbackBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', message: 'Please choose a type and write a message.' }, 400);
    const { kind, token } = parsed.data;
    const message = cleanMessage(parsed.data.message);
    if (message.length < 5) return c.json({ error: 'bad_request', message: 'Please write a little more.' }, 400);
    const email = parsed.data.email?.trim() || null;
    if (email && !validEmail(email)) return c.json({ error: 'bad_request', message: "That email address doesn't look right." }, 400);

    // A bot check on every message: feedback is rare, so this costs real people very little.
    if (env.TURNSTILE_SECRET) {
      const ok = typeof token === 'string' && (await verifyTurnstile(env.TURNSTILE_SECRET, token, c.req.header('cf-connecting-ip') ?? null));
      if (!ok) return c.json({ error: 'verify', message: 'Verification failed. Please try again.' }, 403);
    }

    const issue = feedbackIssue({
      kind,
      message,
      email,
      page: parsed.data.page,
      screen: parsed.data.screen,
      userAgent: c.req.header('user-agent'),
      sender: env.SESSION_SECRET ? (await ipHash(env.SESSION_SECRET, ip)).slice(0, 8) : null,
      sentAt: new Date(),
    });
    const res = await fetch(`https://api.github.com/repos/${env.FEEDBACK_REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'riverguide-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(issue),
    });
    if (!res.ok) {
      console.error('feedback issue failed', res.status, (await res.text()).slice(0, 500));
      return c.json({ error: 'upstream', message: "Couldn't send your message just now. Please try again later." }, 502);
    }
    return c.json({ ok: true }, 201);
  });
}
