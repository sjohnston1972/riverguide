import { describe, expect, it } from 'vitest';
import { cleanMessage, feedbackIssue, validEmail } from '../src/worker/feedback.ts';

describe('cleanMessage', () => {
  it('keeps line breaks, drops control characters, squeezes blank lines and trims', () => {
    expect(cleanMessage('  hi\r\nthere\u0007\n\n\n\nbye  ')).toBe('hi\nthere \n\nbye');
    expect(cleanMessage('x'.repeat(5000))).toHaveLength(4000);
  });
});

describe('validEmail', () => {
  it('accepts plain addresses and rejects junk', () => {
    expect(validEmail('a.b@example.co.uk')).toBe(true);
    expect(validEmail('nope')).toBe(false);
    expect(validEmail('a@b')).toBe(false);
    expect(validEmail('a b@c.com')).toBe(false);
    expect(validEmail('a`b@c.com')).toBe(false);
  });
});

describe('feedbackIssue', () => {
  const sentAt = new Date('2026-10-27T12:00:00Z');

  it('titles from the first line, labels by kind and lists the context in a table', () => {
    const issue = feedbackIssue({
      kind: 'bug',
      message: 'The Leny shows high but it is low\nSecond line',
      email: 'me@example.com',
      page: '/river/leny',
      screen: '390x844',
      userAgent: 'Mozilla/5.0 | test',
      sender: 'abcd1234',
      sentAt,
    });
    expect(issue.title).toBe('Bug: The Leny shows high but it is low');
    expect(issue.labels).toEqual(['bug', 'from-site']);
    expect(issue.body.startsWith('The Leny shows high but it is low\nSecond line\n')).toBe(true);
    expect(issue.body).toContain('| Page | /river/leny |');
    expect(issue.body).toContain('| Reply to | `me@example.com` |');
    expect(issue.body).toContain(String.raw`| Browser | Mozilla/5.0 \| test |`);
    expect(issue.body).toContain('| Sent | 2026-10-27T12:00:00.000Z |');
  });

  it('shortens long titles and stops @mentions notifying anyone', () => {
    const issue = feedbackIssue({ kind: 'idea', message: `@octocat ${'word '.repeat(30)}`, sentAt });
    expect(issue.title.length).toBeLessThanOrEqual(76);
    expect(issue.title.endsWith('…')).toBe(true);
    expect(issue.title).not.toContain('@octocat');
    expect(issue.body).not.toMatch(/@octocat/);
    expect(issue.labels).toEqual(['idea', 'from-site']);
    expect(issue.body).toContain('| Reply to | — |');
  });
});
