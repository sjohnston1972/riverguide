import { describe, expect, it } from 'vitest';
import { dayChange, gaugeTrend, isStale, linkRank, paddlerStep, relativeToAbsolute, sectionStatus, trendFrom, typicalStatus, ukToday } from '../src/shared/status.ts';
import { latestAndHourAgo, parseTable } from '../src/shared/sepa.ts';

describe('sectionStatus', () => {
  it('classifies against min and max', () => {
    expect(sectionStatus(0.4, false, 0.5, 1.2)).toBe('low');
    expect(sectionStatus(0.8, false, 0.5, 1.2)).toBe('runnable');
    expect(sectionStatus(1.5, false, 0.5, 1.2)).toBe('high');
  });
  it('handles one-sided bands', () => {
    expect(sectionStatus(0.9, false, 0.5, null)).toBe('runnable');
    expect(sectionStatus(2, false, null, 1.2)).toBe('high');
  });
  it('is unknown when stale, missing or unbanded', () => {
    expect(sectionStatus(0.8, true, 0.5, 1.2)).toBe('unknown');
    expect(sectionStatus(null, false, 0.5, 1.2)).toBe('unknown');
    expect(sectionStatus(0.8, false, null, null)).toBe('unknown');
  });
});

describe('typicalStatus / trendFrom / isStale', () => {
  it('compares to the typical range', () => {
    expect(typicalStatus(0.2, 0.3, 1.8)).toBe('below');
    expect(typicalStatus(1.0, 0.3, 1.8)).toBe('typical');
    expect(typicalStatus(2.0, 0.3, 1.8)).toBe('above');
    expect(typicalStatus(1.0, null, 1.8)).toBe('unknown');
  });
  it('derives trend with a deadband', () => {
    expect(trendFrom(1.05, 1.0)).toBe('rising');
    expect(trendFrom(0.95, 1.0)).toBe('falling');
    expect(trendFrom(1.005, 1.0)).toBe('steady');
    expect(trendFrom(1.0, null)).toBe('unknown');
  });
  it('treats readings older than 3 hours as stale', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(isStale('2026-10-06T10:00:00Z', now)).toBe(false);
    expect(isStale('2026-10-06T08:00:00Z', now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
    expect(isStale('not a time', now)).toBe(true);
  });
});

describe('linkRank / relativeToAbsolute', () => {
  it('prefers manual, then confidence, then relation', () => {
    const manualLow = linkRank({ basis: 'manual', confidence: 'low', relation: 'proxy' });
    const estHigh = linkRank({ basis: 'guide', confidence: 'high', relation: 'on-section' });
    const estHighProxy = linkRank({ basis: 'guide', confidence: 'high', relation: 'proxy' });
    expect(manualLow).toBeLessThan(estHigh);
    expect(estHigh).toBeLessThan(estHighProxy);
  });
  it('maps typical-range fractions to metres', () => {
    expect(relativeToAbsolute(0.5, 0.2, 1.2)).toBe(0.7);
    expect(relativeToAbsolute(null, 0.2, 1.2)).toBeNull();
    expect(relativeToAbsolute(0.5, null, 1.2)).toBeNull();
  });
});

describe('SEPA parsing', () => {
  it('turns KiWIS header+rows into objects', () => {
    expect(parseTable([['a', 'b'], ['1', '2']])).toEqual([{ a: '1', b: '2' }]);
    expect(parseTable({ type: 'error' })).toEqual([]);
  });
  it('finds the latest value and the value an hour earlier', () => {
    const pts: Array<[string, number]> = [
      ['2026-10-06T10:00:00Z', 1.0],
      ['2026-10-06T10:30:00Z', 1.1],
      ['2026-10-06T11:00:00Z', 1.2],
      ['2026-10-06T11:15:00Z', 1.25],
    ];
    expect(latestAndHourAgo(pts)).toEqual({ latest: ['2026-10-06T11:15:00Z', 1.25], hourAgo: 1.0 });
    expect(latestAndHourAgo([])).toEqual({ latest: null, hourAgo: null });
  });
});

describe('paddlerStep / ukToday', () => {
  const levels = { scrape: 0.4, low: 0.6, medium: 0.8, high: 1.0, very_high: 1.4, huge: 1.8 };
  it('places a level on the paddler scale (thresholds start each step)', () => {
    expect(paddlerStep(0.3, false, levels)).toBe('empty');
    expect(paddlerStep(0.4, false, levels)).toBe('scrape');
    expect(paddlerStep(0.85, false, levels)).toBe('medium');
    expect(paddlerStep(1.5, false, levels)).toBe('very_high');
    expect(paddlerStep(2.5, false, levels)).toBe('huge');
  });
  it('is null when stale, missing or unscaled', () => {
    expect(paddlerStep(0.85, true, levels)).toBeNull();
    expect(paddlerStep(null, false, levels)).toBeNull();
    expect(paddlerStep(0.85, false, null)).toBeNull();
  });
  it('uses the UK date, not UTC', () => {
    expect(ukToday(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02'); // BST
    expect(ukToday(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01'); // GMT
  });
});

describe('gaugeTrend', () => {
  const at = '2026-10-07T19:15:00.000Z';
  it("uses SEPA's rising/falling flag while it is current", () => {
    // A slow fall (0.3 cm in the hour) reads steady from the hourly change, but SEPA says falling.
    expect(gaugeTrend(0.803, 0.806, at, -1, at)).toBe('falling');
    expect(gaugeTrend(0.8, 0.8, at, 1, '2026-10-07T18:45:00.000Z')).toBe('rising');
    expect(gaugeTrend(0.8, 0.7, at, 0, at)).toBe('steady');
  });
  it('falls back to the hourly change when the flag is missing or old', () => {
    expect(gaugeTrend(0.803, 0.806, at, null, null)).toBe('steady');
    expect(gaugeTrend(0.9, 0.8, at, -1, '2026-10-07T15:00:00.000Z')).toBe('rising');
  });
});

describe('dayChange', () => {
  it('is the change over about a day, or null when the readings are not a day apart', () => {
    expect(dayChange(0.8, '2026-10-07T19:15:00Z', 0.9, '2026-10-06T19:15:00Z')).toBeCloseTo(-0.1, 9);
    expect(dayChange(0.8, '2026-10-07T19:15:00Z', 0.9, '2026-10-07T07:15:00Z')).toBeNull();
    expect(dayChange(0.8, '2026-10-07T19:15:00Z', null, null)).toBeNull();
  });
});
