import { describe, expect, it } from 'vitest';
import type { ForecastModel } from '../src/shared/forecast.ts';
import { computeOutlook, type StoredRain } from '../src/worker/outlook.ts';

const now = Date.parse('2026-10-08T12:00:00Z');
const rain = (today: number, tomorrow: number, over: Partial<StoredRain> = {}): StoredRain => ({
  day: '2026-10-08',
  yesterday: 0,
  today,
  tomorrow,
  dayAfter: 0,
  at: '2026-10-08T11:30:00.000Z',
  ...over,
});
const noModel: ForecastModel = { usable: false, skill: 0, skill_wet: null, days: 0 };

describe('computeOutlook without a usable model (direction from trend and rain)', () => {
  const dir = (trend: Parameters<typeof computeOutlook>[1], today: number, tomorrow: number) =>
    computeOutlook(0.5, trend, noModel, rain(today, tomorrow), now)?.direction;

  it('rises on heavy rain whatever the trend, or on moderate rain while already rising', () => {
    expect(dir('falling', 10, 6)).toBe('rise');
    expect(dir('rising', 3, 3)).toBe('rise');
    expect(dir('steady', 3, 3)).toBe('steady');
  });

  it('falls when falling and little rain is due, or when it is dry and not rising', () => {
    expect(dir('falling', 2, 2)).toBe('fall');
    expect(dir('steady', 0.5, 1)).toBe('fall');
    expect(dir('unknown', 0.5, 1)).toBe('fall');
    expect(dir('rising', 0.5, 1)).toBe('steady');
  });

  it('gives no numbers, only a direction', () => {
    expect(computeOutlook(0.5, 'steady', noModel, rain(1, 1), now)).toMatchObject({ basis: 'trend', tomorrow: null, day_after: null });
  });
});

describe('computeOutlook freshness', () => {
  it('gives nothing without rain, with rain from another UK day, or with rain over 6 hours old', () => {
    expect(computeOutlook(0.5, 'steady', noModel, null, now)).toBeNull();
    expect(computeOutlook(0.5, 'steady', noModel, rain(1, 1, { day: '2026-10-07' }), now)).toBeNull();
    expect(computeOutlook(0.5, 'steady', noModel, rain(1, 1, { at: '2026-10-08T05:00:00.000Z' }), now)).toBeNull();
  });
});
