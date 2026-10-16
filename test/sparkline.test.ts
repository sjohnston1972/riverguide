// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SPARK_H, SPARK_W, sparkGeometry, type SparkInput, sparkline } from '../src/client/sparkline.ts';

// 16 October 2026 is BST: midday tomorrow (UK) is 11:00 UTC on the 17th.
const at = '2026-10-16T09:00:00.000Z';
const input = (over: Partial<SparkInput> = {}): SparkInput => ({
  // 24 hourly levels from 09:00 yesterday, rising then falling back.
  recent: { start: '2026-10-15T09:00:00.000Z', levels: Array.from({ length: 24 }, (_, i) => 0.5 + 0.3 * Math.sin((i / 23) * Math.PI)) },
  level: 0.5,
  level_at: at,
  min_level: 0.4,
  max_level: 1,
  tomorrow: { level: 0.42, lo: 0.3, hi: 0.5 },
  ...over,
});

const xs = (d: string) => [...d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => Number(m[1]));
const ys = (d: string) => [...d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));

describe('sparkGeometry', () => {
  it('runs from a day before the latest reading, through it, to midday tomorrow', () => {
    const g = sparkGeometry(input())!;
    const line = xs(g.line);
    expect(line[0]).toBeCloseTo(2, 0);
    expect(line[line.length - 1]).toBe(g.nowX);
    // A day back and 26 hours on: "now" sits 24/50 of the way across.
    expect(g.nowX).toBeCloseTo(2 + (24 / 50) * (SPARK_W - 4), 0);
    const ahead = xs(g.outlook);
    expect(ahead[0]).toBe(g.nowX);
    expect(ahead[ahead.length - 1]).toBeCloseTo(SPARK_W - 2, 0);
  });

  it('keeps everything inside the box and shades the runnable band', () => {
    const g = sparkGeometry(input())!;
    for (const y of [...ys(g.line), ...ys(g.outlook), ...ys(g.range)]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SPARK_H);
    }
    expect(g.band).not.toBeNull();
    expect(g.band![0]).toBeLessThan(g.band![1]);
  });

  it('has no band when the runnable range is off the chart, and runs to the box edge when only one end is set', () => {
    expect(sparkGeometry(input({ min_level: 5, max_level: 6 }))!.band).toBeNull();
    expect(sparkGeometry(input({ min_level: 0.6, max_level: null }))!.band![0]).toBe(0);
  });

  it('leaves gaps unjoined and draws no outlook without one', () => {
    const levels = input().recent!.levels.map((v, i) => (i >= 8 && i <= 12 ? null : v));
    const g = sparkGeometry(input({ recent: { start: '2026-10-15T09:00:00.000Z', levels }, tomorrow: null }))!;
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.outlook).toBe('');
    expect(g.range).toBe('');
  });

  it('draws nothing without readings or a current level', () => {
    expect(sparkGeometry(input({ recent: null }))).toBeNull();
    expect(sparkGeometry(input({ level: null }))).toBeNull();
    expect(sparkGeometry(input({ recent: { start: '2026-10-14T00:00:00.000Z', levels: [0.5] } }))).toBeNull();
  });
});

describe('sparkline', () => {
  it('is a decorative svg, and is left out for an old reading', () => {
    const svg = sparkline({ ...input(), stale: false })!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('.spark-band, .spark-range, .spark-now, .spark-outlook, .spark-line, .spark-dot')).toHaveLength(6);
    expect(sparkline({ ...input(), stale: true })).toBeNull();
  });
});
