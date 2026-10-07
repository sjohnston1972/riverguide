import { describe, expect, it } from 'vitest';
import { direction, type ForecastModel, gridIndex, lookupChange, predictLevels, RAIN_NODES } from '../src/shared/forecast.ts';

// Synthetic gauge: level nodes 0.2..1.6 m; next-day change = 0.05 per mm of rain tomorrow (capped by the grid),
// minus a recession of 10% of the level; range ±0.1 m.
const levels = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
const n = levels.length * RAIN_NODES.length * RAIN_NODES.length;
const med = Array(n).fill(0);
const p10 = Array(n).fill(0);
const p90 = Array(n).fill(0);
levels.forEach((L, li) =>
  RAIN_NODES.forEach((_, ai) =>
    RAIN_NODES.forEach((b, bi) => {
      const i = gridIndex(li, ai, bi);
      med[i] = 0.01 * b - 0.1 * L;
      p10[i] = med[i] - 0.1;
      p90[i] = med[i] + 0.1;
    }),
  ),
);
const model: ForecastModel = { usable: true, skill: 0.3, skill_wet: 0.2, days: 1000, levels, med, p10, p90 };

describe('lookupChange', () => {
  it('returns grid values at nodes and interpolates between them', () => {
    expect(lookupChange(model, 1.0, 0, 10)[0]).toBeCloseTo(0.1 - 0.1, 6);
    expect(lookupChange(model, 0.9, 0, 0)[0]).toBeCloseTo(-0.09, 6); // halfway between 0.8 and 1.0
    // Rain is interpolated on a square-root scale: 7 mm sits between the 5 and 10 mm nodes.
    const c = lookupChange(model, 1.0, 0, 7)[0];
    expect(c).toBeGreaterThan(0.05 - 0.1);
    expect(c).toBeLessThan(0.1 - 0.1);
  });

  it('clamps outside the grid', () => {
    expect(lookupChange(model, 5, 0, 0)[0]).toBeCloseTo(-0.16, 6);
    expect(lookupChange(model, 1.0, 0, 200)[0]).toBeCloseTo(0.4 - 0.1, 6);
  });
});

describe('predictLevels', () => {
  it('recedes when dry, rises with rain, and widens the range for the day after', () => {
    const dry = predictLevels(model, 1.0, { yesterday: 0, today: 0, tomorrow: 0, dayAfter: 0 });
    expect(dry.tomorrow.level).toBeCloseTo(0.9, 3);
    expect(dry.tomorrow.lo).toBeCloseTo(0.8, 3);
    expect(dry.tomorrow.hi).toBeCloseTo(1.0, 3);
    expect(dry.dayAfter.level).toBeCloseTo(0.81, 3);
    expect(dry.dayAfter.hi - dry.dayAfter.lo).toBeGreaterThan(dry.tomorrow.hi - dry.tomorrow.lo);

    const wet = predictLevels(model, 0.6, { yesterday: 0, today: 5, tomorrow: 20, dayAfter: 0 });
    expect(wet.tomorrow.level).toBeCloseTo(0.6 + 0.2 - 0.06, 3);
  });

  it('never predicts below zero', () => {
    const o = predictLevels(model, 0, { yesterday: 0, today: 0, tomorrow: 0, dayAfter: 0 });
    expect(o.tomorrow.level).toBeGreaterThanOrEqual(0);
    expect(o.tomorrow.lo).toBe(0);
  });
});

describe('direction', () => {
  it('counts changes over 10% of the level (min 3 cm) as rise or fall', () => {
    expect(direction(1.0, { level: 1.3, lo: 1.1, hi: 1.5 })).toBe('rise');
    expect(direction(1.0, { level: 0.7, lo: 0.6, hi: 0.9 })).toBe('fall');
    expect(direction(1.0, { level: 1.05, lo: 0.9, hi: 1.15 })).toBe('steady');
    expect(direction(0.445, { level: 0.538, lo: 0.42, hi: 0.809 })).toBe('rise');
    expect(direction(0.2, { level: 0.22, lo: 0.15, hi: 0.3 })).toBe('steady');
  });
});

describe('trend-aware models', () => {
  // Same synthetic gauge, plus a trend dimension: the next day's change carries on half of the last day's change.
  const deltas = [-0.2, -0.05, 0, 0.05, 0.2];
  const nd = deltas.length;
  const size = levels.length * nd * RAIN_NODES.length * RAIN_NODES.length;
  const tmed = Array(size).fill(0);
  levels.forEach((L, li) =>
    deltas.forEach((d, di) =>
      RAIN_NODES.forEach((_, ai) =>
        RAIN_NODES.forEach((b, bi) => {
          tmed[gridIndex(li, ai, bi, di, nd)] = 0.01 * b - 0.1 * L + 0.5 * d;
        }),
      ),
    ),
  );
  const trendModel: ForecastModel = { ...model, deltas, med: tmed, p10: tmed.map((v) => v - 0.1), p90: tmed.map((v) => v + 0.1) };

  it('uses the change since yesterday when the model has it', () => {
    expect(lookupChange(trendModel, 1.0, 0, 0, -0.2)[0]).toBeCloseTo(-0.1 - 0.1, 6);
    expect(lookupChange(trendModel, 1.0, 0, 0, 0)[0]).toBeCloseTo(-0.1, 6);
    expect(lookupChange(trendModel, 1.0, 0, 0, -0.1)[0]).toBeCloseTo(-0.1 - 0.05, 6); // interpolated
  });

  it('a falling river is predicted lower than a steady one at the same level and rain', () => {
    const rain = { yesterday: 0, today: 1, tomorrow: 9, dayAfter: 0 };
    expect(predictLevels(trendModel, 0.8, rain, -0.1).tomorrow.level).toBeLessThan(predictLevels(trendModel, 0.8, rain, 0).tomorrow.level);
  });

  it('plain models ignore the trend', () => {
    expect(lookupChange(model, 1.0, 0, 0, -0.2)[0]).toBeCloseTo(lookupChange(model, 1.0, 0, 0, 0)[0], 9);
  });
});
