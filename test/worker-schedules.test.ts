import { describe, expect, it } from 'vitest';
import { ukLocalNow } from '../src/shared/freshets.ts';
import { ukToday } from '../src/shared/status.ts';
import { damSchedule, releasesOverview, releasingToday } from '../src/worker/schedules.ts';

interface Freshet {
  source: string;
  location: string;
  start: string;
  end: string;
  volume_m3: number;
  hours: number;
}

/** A D1 stand-in that answers the handful of queries schedules.ts makes. */
function fakeDb(data: { releases?: Array<{ slug: string; day: string }>; freshets?: Freshet[]; sections?: Array<{ slug: string; name: string; grade_text: string }> }): D1Database {
  const f = data.freshets ?? [];
  const run = (sql: string, a: unknown[]): unknown[] => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q === 'SELECT slug FROM releases WHERE day = ?') return (data.releases ?? []).filter((r) => r.day === a[0]);
    if (q === 'SELECT DISTINCT source FROM freshets WHERE start < ? AND end > ?')
      return [...new Set(f.filter((r) => r.start < (a[0] as string) && r.end > (a[1] as string)).map((r) => r.source))].map((source) => ({ source }));
    if (q === 'SELECT DISTINCT source FROM freshets') return [...new Set(f.map((r) => r.source))].map((source) => ({ source }));
    if (q === 'SELECT * FROM freshets WHERE source = ? AND end > ? ORDER BY start LIMIT 10')
      return f.filter((r) => r.source === a[0] && r.end > (a[1] as string)).sort((x, y) => x.start.localeCompare(y.start)).slice(0, 10);
    if (q === 'SELECT 1 FROM freshets WHERE source = ? LIMIT 1') return f.some((r) => r.source === a[0]) ? [{ 1: 1 }] : [];
    if (q === 'SELECT * FROM freshets WHERE end > ? ORDER BY start') return f.filter((r) => r.end > (a[0] as string)).sort((x, y) => x.start.localeCompare(y.start));
    if (q === 'SELECT slug, name, grade_text FROM sections') return data.sections ?? [];
    throw new Error(`fakeDb: unexpected query: ${q}`);
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    all: async () => ({ results: run(sql, args) }),
    first: async () => run(sql, args)[0] ?? null,
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

const today = ukToday();
const at = (hhmm: string, day = today) => `${day}T${hhmm}`;
const tomorrow = ukToday(new Date(Date.now() + 86_400_000));

describe('releasingToday', () => {
  it('flags sections below a dam releasing in paddling hours, not ones releasing overnight or another day', async () => {
    const db = fakeDb({
      freshets: [
        { source: 'garry', location: 'Garry (Invergarry)', start: at('10:00'), end: at('16:00'), volume_m3: 500_000, hours: 6 },
        { source: 'lyon', location: 'Lyon', start: at('01:00'), end: at('05:00'), volume_m3: 100_000, hours: 4 },
        { source: 'moriston', location: 'Dundreggan', start: at('10:00', tomorrow), end: at('16:00', tomorrow), volume_m3: 500_000, hours: 6 },
      ],
    });
    const out = await releasingToday(db);
    expect(out.has('river-garry')).toBe(true);
    expect([...out].some((s) => s.startsWith('river-lyon'))).toBe(false);
    expect([...out].some((s) => s.startsWith('river-moriston'))).toBe(false);
  });

  it("uses a Where's the Water date only where SEPA's schedule doesn't cover the section", async () => {
    const releases = [
      { slug: 'river-garry', day: today },
      { slug: 'some-other-river', day: today },
    ];
    // Garry's schedule is loaded (a release tomorrow), so its Where's the Water date is ignored.
    const loaded = fakeDb({ releases, freshets: [{ source: 'garry', location: 'Garry', start: at('10:00', tomorrow), end: at('16:00', tomorrow), volume_m3: 1, hours: 6 }] });
    const a = await releasingToday(loaded);
    expect(a.has('river-garry')).toBe(false);
    expect(a.has('some-other-river')).toBe(true);
    // Nothing imported yet: the Where's the Water date stands.
    expect((await releasingToday(fakeDb({ releases }))).has('river-garry')).toBe(true);
  });
});

describe('damSchedule', () => {
  it('is null for a section with no dam, or before anything is stored for its dam', async () => {
    expect(await damSchedule(fakeDb({}), 'river-coe-glencoe-visitor-centre-to-loch-leven')).toBeNull();
    expect(await damSchedule(fakeDb({}), 'river-garry')).toBeNull();
  });

  it('lists upcoming releases with their size, dropping ones already over', async () => {
    const now = ukLocalNow();
    const db = fakeDb({
      freshets: [
        { source: 'garry', location: 'Garry', start: '2000-01-01T10:00', end: '2000-01-01T16:00', volume_m3: 1, hours: 6 },
        { source: 'garry', location: 'Garry', start: at('10:00', tomorrow), end: at('15:00', tomorrow), volume_m3: 180_000, hours: 5 },
      ],
    });
    const s = await damSchedule(db, 'river-garry');
    expect(s).toMatchObject({ key: 'garry', river: 'River Garry', dam: 'Invergarry dam' });
    expect(s!.releases).toHaveLength(1);
    expect(s!.releases[0]).toMatchObject({ hours: 5, cumecs: 10 }); // 180,000 m3 over 5 h = 10 m3/s
    expect(s!.releases[0].end > now).toBe(true);
  });
});

describe('releasesOverview', () => {
  it('lists every mapped dam, adds unmapped schedule locations, and puts the soonest release first', async () => {
    const db = fakeDb({
      sections: [{ slug: 'river-garry', name: 'Garry', grade_text: '3' }],
      freshets: [
        { source: 'garry', location: 'Garry', start: at('12:00', tomorrow), end: at('16:00', tomorrow), volume_m3: 1, hours: 4 },
        { source: 'new-place', location: 'New Place', start: at('09:00', tomorrow), end: at('11:00', tomorrow), volume_m3: 1, hours: 2 },
      ],
    });
    const o = await releasesOverview(db);
    expect(o.dams[0]).toMatchObject({ key: 'new-place', river: 'New Place', sections: [] });
    expect(o.dams[1]).toMatchObject({ key: 'garry', sections: [{ slug: 'river-garry' }] });
    expect(o.dams.find((d) => d.key === 'lyon')?.releases).toEqual([]);
  });
});
