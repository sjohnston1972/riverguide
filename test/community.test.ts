import { describe, expect, it } from 'vitest';
import { type CalibrationPoint, deriveBand, levelAt, splitLevel, type Verdict } from '../src/shared/community.ts';

let n = 0;
const p = (level: number, verdict: Verdict, opts: Partial<CalibrationPoint> = {}): CalibrationPoint => ({
  level,
  verdict,
  weight: 1,
  person: `p${n++ % 4}`,
  day: `2026-10-0${(n % 3) + 1}`,
  ...opts,
});
const est = { min: 0.8, max: 1.6 };

describe('splitLevel', () => {
  it('splits cleanly separated groups halfway', () => {
    expect(splitLevel([p(0.5, 'too_low'), p(0.6, 'too_low')], [p(0.8, 'good'), p(0.9, 'good')])).toBe(0.7);
  });
  it('tolerates an outlier, and weights shift the split', () => {
    const below = [p(0.5, 'too_low'), p(0.55, 'too_low'), p(0.95, 'too_low')];
    const above = [p(0.8, 'good'), p(0.9, 'good'), p(1.0, 'good'), p(1.1, 'good')];
    const t = splitLevel(below, above);
    expect(t).toBeGreaterThan(0.55);
    expect(t).toBeLessThanOrEqual(0.8);
  });
});

describe('deriveBand', () => {
  it('needs 5 reports from 3 people on 2 days', () => {
    const few = [p(0.9, 'good'), p(1.0, 'good'), p(0.5, 'too_low'), p(0.6, 'too_low')];
    expect(deriveBand(few, est)).toBeNull();
    const onePerson = [0.9, 1.0, 1.1, 0.5, 0.6].map((l) => p(l, l < 0.7 ? 'too_low' : 'good', { person: 'same' }));
    expect(deriveBand(onePerson, est)).toBeNull();
    const oneDay = [0.9, 1.0, 1.1, 0.5, 0.6].map((l) => p(l, l < 0.7 ? 'too_low' : 'good', { day: '2026-10-01' }));
    expect(deriveBand(oneDay, est)).toBeNull();
  });

  it('sets the lower threshold between too-low and runnable reports and keeps the estimated upper one', () => {
    const pts = [p(0.5, 'too_low'), p(0.6, 'too_low'), p(0.7, 'scrapy'), p(0.9, 'good'), p(1.2, 'good')];
    const b = deriveBand(pts, est)!;
    expect(b.min_level).toBe(0.65);
    expect(b.max_level).toBe(1.6);
    expect(b).toMatchObject({ reports: 5, confidence: 'medium' });
  });

  it('only lowers the estimate when everyone found it runnable', () => {
    const pts = [p(0.6, 'good'), p(0.7, 'good'), p(0.9, 'good'), p(1.0, 'pushy'), p(1.1, 'good')];
    expect(deriveBand(pts, est)!.min_level).toBe(0.6);
    const higher = [1.0, 1.1, 1.2, 1.3, 1.4].map((l) => p(l, 'good'));
    expect(deriveBand(higher, est)!.min_level).toBe(0.8); // no evidence it is too low below 1.0
  });

  it('sets the upper threshold from too-high reports', () => {
    const pts = [p(1.0, 'good'), p(1.2, 'pushy'), p(1.3, 'pushy'), p(1.5, 'too_high'), p(1.7, 'too_high')];
    expect(deriveBand(pts, est)!.max_level).toBe(1.4);
  });

  it('gives up when reports contradict each other', () => {
    const pts = [p(1.0, 'too_low'), p(1.1, 'too_low'), p(1.2, 'too_low'), p(0.5, 'too_high'), p(0.6, 'too_high')];
    expect(deriveBand(pts, est)).toBeNull();
  });
});

describe('levelAt', () => {
  const pts = [
    { t: '2026-10-06T10:00:00Z', v: 0.8 },
    { t: '2026-10-06T11:00:00Z', v: 0.9 },
  ];
  it('picks the nearest reading within the window', () => {
    expect(levelAt(pts, Date.parse('2026-10-06T10:40:00Z'))).toBe(0.9);
    expect(levelAt(pts, Date.parse('2026-10-06T16:00:00Z'))).toBeNull();
  });
});
