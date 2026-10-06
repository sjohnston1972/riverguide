import { describe, expect, it } from 'vitest';
import { costMicrodollars, readCookie, signSession, verifySession } from '../src/worker/guard.ts';
import { summariseWeather } from '../src/worker/weather.ts';
import { toApiMessages } from '../src/worker/chat/handler.ts';

describe('chat session tokens', () => {
  it('verifies its own tokens and rejects tampering, expiry and other secrets', async () => {
    const now = 1_800_000_000;
    const token = await signSession('secret-a', now);
    expect(await verifySession('secret-a', token, now + 60)).toBe(true);
    expect(await verifySession('secret-b', token, now + 60)).toBe(false);
    expect(await verifySession('secret-a', token, now + 3 * 60 * 60)).toBe(false);
    const [exp, id, sig] = token.split('.');
    expect(await verifySession('secret-a', `${Number(exp) + 9999}.${id}.${sig}`, now)).toBe(false);
    expect(await verifySession('secret-a', undefined, now)).toBe(false);
  });

  it('reads a cookie by name', () => {
    expect(readCookie('a=1; rg_chat=x.y.z; b=2', 'rg_chat')).toBe('x.y.z');
    expect(readCookie(null, 'rg_chat')).toBeUndefined();
  });
});

describe('costMicrodollars', () => {
  it('prices Haiku 4.5 usage including cache reads and writes', () => {
    expect(costMicrodollars({ input_tokens: 1000, output_tokens: 200 })).toBe(2000);
    expect(
      costMicrodollars({ input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 4000, cache_read_input_tokens: 10000 }),
    ).toBe(100 + 5000 + 1000);
  });
});

describe('toApiMessages', () => {
  it('keeps the last 12 turns, starts on a user turn, trims user text and adds page context', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i === 14 ? 'x'.repeat(1500) : `turn ${i}`,
    }));
    const out = toApiMessages({ messages, context_slug: 'river-leny' });
    expect(out[0].role).toBe('user');
    expect(out.length).toBeLessThanOrEqual(12);
    const last = out[out.length - 1].content as string;
    expect(last.startsWith('[The user is viewing the section page with slug "river-leny".]')).toBe(true);
    expect(last.length).toBeLessThan(1100);
  });
});

describe('summariseWeather', () => {
  it('splits rain into past 24h and next 24/48h around the current hour', () => {
    const start = Date.parse('2026-10-05T12:00:00Z');
    const time: string[] = [];
    const precipitation: number[] = [];
    for (let h = 0; h < 96; h++) {
      time.push(new Date(start + h * 3_600_000).toISOString().slice(0, 16));
      precipitation.push(h < 24 ? 1 : h < 48 ? 0.5 : 0);
    }
    const n = time.length;
    const w = summariseWeather(57, -5, {
      hourly: { time, precipitation, temperature_2m: Array(n).fill(8), wind_speed_10m: Array(n).fill(10) },
    }, Date.parse('2026-10-06T12:30:00Z'));
    expect(w.rain_past_24h_mm).toBe(24);
    expect(w.rain_next_24h_mm).toBe(12);
    expect(w.rain_next_48h_mm).toBe(12);
    expect(w.hours[0].time).toBe('2026-10-06T12:00:00Z');
    expect(w.hours).toHaveLength(48);
  });
});
