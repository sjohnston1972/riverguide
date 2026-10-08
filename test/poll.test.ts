import { describe, expect, it } from 'vitest';
import { type GaugePollRow, nextGaugeState, type PollFetched, rainIsDue } from '../src/worker/poll.ts';
import type { StoredRain } from '../src/worker/outlook.ts';

const now = new Date('2026-10-08T12:00:00Z');
const rain: StoredRain = { day: '2026-10-08', yesterday: 0, today: 1, tomorrow: 1, dayAfter: 0, at: '2026-10-08T11:30:00.000Z' };
// A model that is not usable gives a trend-based outlook, which is enough to exercise the write logic.
const model = JSON.stringify({ usable: false, skill: 0, skill_wet: null, days: 0 });

const row = (over: Partial<GaugePollRow> = {}): GaugePollRow => ({
  station_no: '1',
  ts_id: 't1',
  rf_ts_id: 'r1',
  lat: 57,
  lon: -5,
  level: 0.5,
  level_at: '2026-10-08T11:45:00.000Z',
  level_hour_ago: 0.5,
  level_day_ago: 0.6,
  level_day_ago_at: '2026-10-07T11:45:00.000Z',
  trend_sepa: 0,
  trend_sepa_at: '2026-10-08T11:45:00.000Z',
  forecast_model: null,
  rain: null,
  outlook: null,
  ...over,
});

const none = (): PollFetched => ({ levels: new Map(), dayAgo: new Map(), flags: new Map(), rain: new Map() });

describe('nextGaugeState', () => {
  it('skips the write when nothing changed', () => {
    const f = none();
    f.levels.set('1', { level: 0.5, at: '2026-10-08T11:45:00.000Z', hourAgo: 0.5 });
    expect(nextGaugeState(row(), f, now)).toBeNull();
  });

  it('writes a new reading and keeps stored values for anything not fetched', () => {
    const f = none();
    f.levels.set('1', { level: 0.55, at: '2026-10-08T12:00:00.000Z', hourAgo: 0.5 });
    const n = nextGaugeState(row(), f, now);
    expect(n).toMatchObject({ level: 0.55, level_at: '2026-10-08T12:00:00.000Z', level_day_ago: 0.6, trend_sepa: 0 });
  });

  it('keeps the stored reading when the fetch for that gauge failed', () => {
    const n = nextGaugeState(row({ level: 0.7 }), none(), now);
    expect(n).toBeNull();
  });

  it('computes an outlook for a modelled gauge and leaves it alone while it is unchanged and recent', () => {
    const f = none();
    f.rain.set('1', rain);
    const first = nextGaugeState(row({ forecast_model: model }), f, now)!;
    expect(first.outlook).not.toBeNull();
    expect(JSON.parse(first.outlook!).direction).toBeDefined();

    const later = new Date(now.getTime() + 15 * 60_000);
    expect(nextGaugeState(row({ forecast_model: model, rain: first.rain, outlook: first.outlook }), none(), later)).toBeNull();
  });

  it('rewrites an unchanged outlook once it is an hour old, so the API keeps accepting it', () => {
    const f = none();
    f.rain.set('1', rain);
    const first = nextGaugeState(row({ forecast_model: model }), f, now)!;
    const later = new Date(now.getTime() + 61 * 60_000);
    const n = nextGaugeState(row({ forecast_model: model, rain: first.rain, outlook: first.outlook }), none(), later);
    expect(n).not.toBeNull();
    expect(JSON.parse(n!.outlook!).at).toBe(later.toISOString());
  });

  it('clears the outlook when the reading goes stale', () => {
    const stored = JSON.stringify({ basis: 'trend', direction: 'steady', tomorrow: null, day_after: null, rain_today_mm: 1, rain_tomorrow_mm: 1, at: now.toISOString() });
    const n = nextGaugeState(row({ forecast_model: model, rain: JSON.stringify(rain), outlook: stored, level_at: '2026-10-08T07:00:00.000Z' }), none(), now);
    expect(n?.outlook).toBeNull();
  });
});

describe('rainIsDue', () => {
  it('is due when missing, older than ~an hour, or from an earlier UK day', () => {
    expect(rainIsDue(null, now)).toBe(true);
    expect(rainIsDue(JSON.stringify(rain), now)).toBe(false);
    expect(rainIsDue(JSON.stringify({ ...rain, at: '2026-10-08T10:30:00.000Z' }), now)).toBe(true);
    // 00:05 BST on the 9th is still 23:05Z on the 8th: the UK day has changed, so refetch.
    const justAfterMidnight = new Date('2026-10-08T23:05:00Z');
    expect(rainIsDue(JSON.stringify({ ...rain, at: '2026-10-08T22:50:00.000Z' }), justAfterMidnight)).toBe(true);
  });
});
