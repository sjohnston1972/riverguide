import { describe, expect, it } from 'vitest';
import { buildCurve, CURVE_PCTS, levelForPct, MIN_DAYS, pctForLevel } from '../src/shared/duration.ts';

// 1,000 days with daily maxima 0.001 .. 1.000 m: level x is reached on (1 - x) of days.
const uniform = Array.from({ length: 1000 }, (_, i) => (i + 1) / 1000);

describe('buildCurve', () => {
  it('maps exceedance percentages to quantiles of daily maxima', () => {
    const c = buildCurve(uniform)!;
    expect(c.map(([p]) => p)).toEqual(CURVE_PCTS);
    const at = (p: number) => c.find(([q]) => q === p)![1];
    expect(at(50)).toBeCloseTo(0.5, 2);
    expect(at(10)).toBeCloseTo(0.9, 2);
    expect(at(99)).toBeCloseTo(0.01, 2);
    // Levels rise as the percentage of days falls.
    for (let i = 1; i < c.length; i++) expect(c[i][1]).toBeGreaterThanOrEqual(c[i - 1][1]);
  });

  it('needs enough days of data and ignores gaps', () => {
    expect(buildCurve(uniform.slice(0, MIN_DAYS - 1))).toBeNull();
    expect(buildCurve([...uniform, NaN, Infinity])).not.toBeNull();
  });
});

describe('levelForPct / pctForLevel', () => {
  const c = buildCurve(uniform)!;
  it('interpolates between stored points and inverts', () => {
    expect(levelForPct(c, 25)).toBeCloseTo(0.75, 2);
    expect(pctForLevel(c, 0.75)).toBeCloseTo(25, 0);
    expect(pctForLevel(c, levelForPct(c, 12))).toBeCloseTo(12, 0);
  });
  it('clamps beyond the ends of the curve', () => {
    expect(pctForLevel(c, 0)).toBe(99);
    expect(pctForLevel(c, 5)).toBe(0.5);
    expect(levelForPct(c, 100)).toBe(c[0][1]);
    expect(levelForPct(c, 0.1)).toBe(c[c.length - 1][1]);
  });
});
