import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { levelHistory } from '../src/worker/poll.ts';

// A minimal Cache API and ExecutionContext: enough for levelHistory's two cache keys.
function fakeCaches() {
  const store = new Map<string, string>();
  return {
    store,
    default: {
      match: async (req: Request) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
      put: async (req: Request, res: Response) => void store.set(req.url, await res.text()),
    },
  };
}
const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext & { pending: Promise<unknown>[] };
};
const sepaOk = () => new Response(JSON.stringify([{ ts_id: 't1', data: [['2026-10-12T07:00:00.000Z', 0.39], ['2026-10-12T07:15:00.000Z', 0.4]] }]));

describe('levelHistory when SEPA is down', () => {
  let caches: ReturnType<typeof fakeCaches>;
  beforeEach(() => {
    caches = fakeCaches();
    vi.stubGlobal('caches', caches);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serves the last good readings, marked unavailable, when SEPA fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sepaOk()));
    const c1 = ctx();
    const good = await levelHistory('1', 't1', 'P2D', c1);
    await Promise.all(c1.pending);
    expect(good.points).toHaveLength(2);
    expect(good.unavailable).toBeUndefined();

    // The 15-minute copy has expired; SEPA now times out.
    caches.store.delete('https://cache.riverguide/history/t1/P2D');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Gateway Time-out', { status: 504 })));
    const down = await levelHistory('1', 't1', 'P2D', ctx());
    expect(down.unavailable).toBe(true);
    expect(down.points.map((p) => p.v)).toEqual([0.39, 0.4]);
  });

  it('treats an empty answer the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sepaOk()));
    const c1 = ctx();
    await levelHistory('1', 't1', 'P7D', c1);
    await Promise.all(c1.pending);
    caches.store.delete('https://cache.riverguide/history/t1/P7D');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ ts_id: 't1', data: [] }]))));
    const empty = await levelHistory('1', 't1', 'P7D', ctx());
    expect(empty).toMatchObject({ unavailable: true });
    expect(empty.points).toHaveLength(2);
  });

  it('reports the failure when there is nothing to fall back on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Gateway Time-out', { status: 504 })));
    await expect(levelHistory('1', 't1', 'P30D', ctx())).rejects.toThrow(/SEPA 504/);
  });
});
