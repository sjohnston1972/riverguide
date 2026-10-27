import { describe, expect, it } from 'vitest';
import { dayChange, gaugeTrend, isStale, linkRank, linkStatus, paddlerStep, relativeToAbsolute, runnableMax, sectionStatus, trendFrom, typicalStatus, ukToday } from '../src/shared/status.ts';
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
  it('is unknown for an inverted band or a non-finite level', () => {
    expect(sectionStatus(0.8, false, 1.2, 0.5)).toBe('unknown');
    expect(sectionStatus(Number.NaN, false, 0.5, 1.2)).toBe('unknown');
  });
  it('works for gauges that read below zero', () => {
    expect(sectionStatus(-0.05, false, -0.1, 0.4)).toBe('runnable');
    expect(sectionStatus(-0.2, false, -0.1, 0.4)).toBe('low');
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
  it('ranks by basis first: manual > community > paddler > estimate, whatever the confidence or relation', () => {
    const worst = { confidence: 'low', relation: 'proxy' } as const;
    const best = { confidence: 'high', relation: 'on-section' } as const;
    const order = ['manual', 'community', 'paddler', 'duration'];
    for (let i = 0; i < order.length - 1; i++) {
      expect(linkRank({ basis: order[i], ...worst })).toBeLessThan(linkRank({ basis: order[i + 1], ...best }));
    }
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

describe('linkStatus / runnableMax', () => {
  // Anie for the Leny: a manual band of 0.9-2.0 m, with Where's the Water levels on the same gauge.
  const levels = { scrape: 0.78, low: 0.9, medium: 1.1, high: 1.3, very_high: 1.55, huge: 1.9 };

  it('counts Very high and Huge as too high whatever the band says', () => {
    expect(linkStatus(1.4, false, 0.9, 2.0, levels)).toBe('runnable');
    expect(linkStatus(1.655, false, 0.9, 2.0, levels)).toBe('high');
    expect(linkStatus(1.55, false, 0.9, 2.0, levels)).toBe('high'); // exactly where Very high starts
    expect(linkStatus(0.8, false, 0.9, 2.0, levels)).toBe('low');
  });

  it('caps the top of the runnable band where Very high starts, never above a lower band top', () => {
    expect(runnableMax(0.78, 1.9, levels)).toBe(1.55);
    expect(runnableMax(0.9, 1.4, levels)).toBe(1.4);
    expect(runnableMax(0.78, null, levels)).toBe(1.55);
    expect(runnableMax(0.6, 2.05, null)).toBe(2.05);
  });

  it('ignores a cap that would turn the band upside down', () => {
    expect(runnableMax(1.6, 2.0, levels)).toBe(2.0);
    expect(linkStatus(1.7, false, 1.6, 2.0, levels)).toBe('runnable');
  });

  it('is unchanged for gauges without paddler levels', () => {
    expect(linkStatus(2.087, false, 0.594, 2.053, null)).toBe('high');
    expect(linkStatus(1.5, false, 0.594, 2.053, null)).toBe('runnable');
    expect(linkStatus(1.5, true, 0.594, 2.053, levels)).toBe('unknown');
  });
});
