import { describe, expect, it } from 'vitest';
import { type CheckedDay, correctRange, intervalScore, learnHorizon, learnOutlook, MIN_SKILL_DAYS, NO_CORRECTION } from '../src/shared/learning.ts';

/** Deterministic noise in [-1, 1). */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return (s / 2 ** 31) * 2 - 1;
  };
}

/** `n` checked days: the model predicts near 1 m, the peak lands at pred + offset + noise, the level then was `nowGap` away. */
function days(n: number, o: { offset?: number; spread?: number; halfRange?: number; nowGap?: number; seed?: number } = {}): CheckedDay[] {
  const r = noise(o.seed ?? 1);
  const { offset = 0, spread = 0.05, halfRange = 0.08, nowGap = 0.1 } = o;
  return Array.from({ length: n }, () => {
    const pred = 1 + 0.3 * r();
    const actual = pred + offset + spread * r();
    return { now: actual - nowGap * (r() < 0 ? -1 : 1), pred, lo: pred - halfRange, hi: pred + halfRange, actual };
  });
}

describe('learnHorizon', () => {
  it('learns nothing without enough checked days', () => {
    expect(learnHorizon([]).correction).toEqual(NO_CORRECTION);
    expect(learnHorizon(days(MIN_SKILL_DAYS - 1, { offset: 0.2 })).correction).toEqual(NO_CORRECTION);
  });

  it('corrects a gauge the model consistently under-predicts, shrunk towards no correction', () => {
    const c = learnHorizon(days(40, { offset: 0.2 })).correction;
    // Median miss 0.2 m over 40 days, shrunk by 40 / (40 + 10).
    expect(c.bias).toBeGreaterThan(0.14);
    expect(c.bias).toBeLessThan(0.2);
  });

  it('leaves an unbiased, well-calibrated gauge alone', () => {
    // Misses uniform within ±0.1 and a range of ±0.08 around the prediction: about 80% inside.
    expect(learnHorizon(days(80, { spread: 0.1, halfRange: 0.08 })).correction).toEqual(NO_CORRECTION);
  });

  it('widens a range that the peaks keep landing outside, and narrows one that is far too wide', () => {
    expect(learnHorizon(days(60, { spread: 0.3, halfRange: 0.05 })).correction.scale).toBeGreaterThan(1.5);
    expect(learnHorizon(days(60, { spread: 0.02, halfRange: 0.3 })).correction.scale).toBeLessThan(0.7);
  });
});

describe('learnOutlook', () => {
  it('reports live skill against "stays at the level now" and demotes a gauge that loses to it', () => {
    // Persistence misses by 0.1, the model by up to 0.05: skilful.
    const good = learnOutlook(days(40), days(40), false);
    expect(good.skill).toBeGreaterThan(0.3);
    expect(good.demoted).toBe(false);
    // Persistence misses by 0.01, the model by up to 0.3: worse than no change.
    const bad = learnOutlook(days(40, { spread: 0.3, nowGap: 0.01 }), [], false);
    expect(bad.skill).toBeLessThan(0);
    expect(bad.demoted).toBe(true);
  });

  it('needs a clearly positive skill to undo a demotion', () => {
    // Model and persistence about equally good.
    const even = days(60, { spread: 0.1, nowGap: 0.05, seed: 7 });
    const l = learnOutlook(even, [], false);
    expect(l.skill).not.toBeNull();
    expect(Math.abs(l.skill!)).toBeLessThan(0.05);
    expect(learnOutlook(even, [], true).demoted).toBe(true);
  });

  it('keeps the current state until there are enough days to judge', () => {
    expect(learnOutlook(days(5), [], true)).toMatchObject({ skill: null, demoted: true, days: 5 });
    expect(learnOutlook([], [], false)).toMatchObject({ skill: null, demoted: false, days: 0 });
  });
});

describe('correctRange', () => {
  it('shifts the prediction and scales each side of the range, never below the floor', () => {
    expect(correctRange({ level: 1, lo: 0.9, hi: 1.2 }, { bias: 0.1, scale: 2 }, 0)).toEqual({ level: 1.1, lo: 0.9, hi: 1.5 });
    expect(correctRange({ level: 0.3, lo: 0.25, hi: 0.4 }, { bias: -0.2, scale: 1 }, 0.2)).toEqual({ level: 0.2, lo: 0.2, hi: 0.2 });
    const p = { level: 1, lo: 0.9, hi: 1.2 };
    expect(correctRange(p, NO_CORRECTION, 0)).toBe(p);
  });
});

describe('intervalScore', () => {
  it('is the width when the peak is inside, plus 10x the miss outside an 80% range', () => {
    expect(intervalScore(1, 1.2, 1.1)).toBeCloseTo(0.2);
    expect(intervalScore(1, 1.2, 1.3)).toBeCloseTo(0.2 + 10 * 0.1);
  });
});
