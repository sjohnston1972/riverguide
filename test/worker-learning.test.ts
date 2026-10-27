import { describe, expect, it } from 'vitest';
import { type ForecastModel, RAIN_NODES } from '../src/shared/forecast.ts';
import type { LearnedOutlook } from '../src/shared/learning.ts';
import { addDays, newPeaks, type SnapshotGaugeRow, snapshotOf } from '../src/worker/learning.ts';
import { computeOutlook } from '../src/worker/outlook.ts';

const now = new Date('2026-10-28T07:15:00Z');
const rain = { day: '2026-10-28', yesterday: 3, today: 4, tomorrow: 10, dayAfter: 1, at: '2026-10-28T07:00:00.000Z' };
// A flat model: the peak rises 0.1 m (range -0.05..+0.3) whatever the inputs.
const cells = 2 * RAIN_NODES.length * RAIN_NODES.length;
const model: ForecastModel = {
  usable: true,
  skill: 0.3,
  skill_wet: 0.2,
  days: 900,
  levels: [0.2, 2],
  med: Array(cells).fill(0.1),
  p10: Array(cells).fill(-0.05),
  p90: Array(cells).fill(0.3),
};

const row = (over: Partial<SnapshotGaugeRow> = {}): SnapshotGaugeRow => ({
  station_no: '14888',
  level: 1,
  level_at: '2026-10-28T07:00:00.000Z',
  level_day_ago: 0.9,
  level_day_ago_at: '2026-10-27T07:00:00.000Z',
  forecast_model: JSON.stringify(model),
  rain: JSON.stringify(rain),
  outlook: JSON.stringify({ basis: 'model', direction: 'rise' }),
  ...over,
});

describe('addDays', () => {
  it('moves across month ends and clock changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
  });
});

describe('snapshotOf', () => {
  it('records the raw model prediction, its inputs and what the site showed', () => {
    expect(snapshotOf(row(), now)).toMatchObject({
      issued_day: '2026-10-28',
      level_now: 1,
      rain_today: 4,
      rain_tomorrow: 10,
      shown_basis: 'model',
      t1: 1.1,
      t1_lo: 0.95,
      t1_hi: 1.3,
      t2: 1.2,
    });
    expect(snapshotOf(row(), now)!.day_change).toBe(0.1);
  });

  it('keeps direction-only gauges, without numbers', () => {
    const s = snapshotOf(
      row({ forecast_model: JSON.stringify({ usable: false, skill: 0, skill_wet: null, days: 0 }), outlook: JSON.stringify({ basis: 'trend', direction: 'fall' }) }),
      now,
    );
    expect(s).toMatchObject({ shown_basis: 'trend', shown_direction: 'fall', t1: null, t2: null });
  });

  it('skips gauges with a stale level, no model, or rain from another day', () => {
    expect(snapshotOf(row({ level_at: '2026-10-27T20:00:00.000Z' }), now)).toBeNull();
    expect(snapshotOf(row({ forecast_model: null }), now)).toBeNull();
    expect(snapshotOf(row({ rain: JSON.stringify({ ...rain, day: '2026-10-27' }) }), now)).toBeNull();
  });
});

describe('newPeaks', () => {
  const peaks = new Map([
    ['2026-10-20', 1.1],
    ['2026-10-21', 1.4],
  ]);
  it('fills in the peaks published so far and keeps ones already recorded', () => {
    expect(newPeaks({ station_no: '1', issued_day: '2026-10-20', actual_d0: null, actual_t1: null, actual_t2: null }, peaks)).toEqual([1.1, 1.4, null]);
    expect(newPeaks({ station_no: '1', issued_day: '2026-10-20', actual_d0: 1.0, actual_t1: null, actual_t2: null }, peaks)).toEqual([1.0, 1.4, null]);
  });
  it('returns null when nothing new is known', () => {
    expect(newPeaks({ station_no: '1', issued_day: '2026-10-20', actual_d0: 1.1, actual_t1: 1.4, actual_t2: null }, peaks)).toBeNull();
  });
});

describe('computeOutlook with learned corrections', () => {
  const learned = (over: Partial<LearnedOutlook>): LearnedOutlook => ({
    days: 40,
    tomorrow: { bias: 0.05, scale: 2 },
    day_after: { bias: 0, scale: 1 },
    skill: 0.2,
    demoted: false,
    at: now.toISOString(),
    ...over,
  });
  const t = now.getTime();

  it('applies the learned bias and range scale', () => {
    const o = computeOutlook(1, 'steady', model, rain, t, 0.1, learned({}));
    expect(o?.tomorrow).toEqual({ level: 1.15, lo: 0.85, hi: 1.55 });
    expect(o?.day_after).toEqual(computeOutlook(1, 'steady', model, rain, t, 0.1)?.day_after);
  });

  it('shows a direction only for a demoted gauge', () => {
    expect(computeOutlook(1, 'steady', model, rain, t, 0.1, learned({ demoted: true }))).toMatchObject({ basis: 'trend', tomorrow: null });
  });
});
