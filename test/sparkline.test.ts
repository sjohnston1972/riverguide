// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SPARK_H, SPARK_W, sparkGeometry, type SparkInput, sparkline } from '../src/client/sparkline.ts';

// 16 October 2026 is BST: midday tomorrow (UK) is 11:00 UTC on the 17th.
const at = '2026-10-16T09:00:00.000Z';
const input = (over: Partial<SparkInput> = {}): SparkInput => ({
  // 48 hourly levels from 09:00 two days ago, rising then falling back.
  recent: { start: '2026-10-14T09:00:00.000Z', levels: Array.from({ length: 48 }, (_, i) => 0.5 + 0.3 * Math.sin((i / 47) * Math.PI)) },
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
  it('runs from two days before the latest reading, through it, to midday tomorrow', () => {
    const g = sparkGeometry(input())!;
    const line = xs(g.line);
    expect(line[0]).toBeCloseTo(2, 0);
    expect(line[line.length - 1]).toBe(g.nowX);
    // Two days back and 26 hours on: "now" sits 48/74 of the way across.
    expect(g.nowX).toBeCloseTo(2 + (48 / 74) * (SPARK_W - 4), 0);
    const ahead = xs(g.outlook);
    expect(ahead[0]).toBe(g.nowX);
    expect(ahead[ahead.length - 1]).toBeCloseTo(SPARK_W - 2, 0);
  });

  it('keeps everything inside the box, and shades runnable above the minimum and too low beneath it', () => {
    const g = sparkGeometry(input())!;
    for (const y of [...ys(g.line), ...ys(g.outlook), ...ys(g.range)]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SPARK_H);
    }
    // The minimum (0.4 m) is on the chart, the maximum (1 m) above it.
    const { runnable, low, high } = g.zones;
    expect(runnable![0]).toBe(0);
    expect(low![1]).toBe(SPARK_H);
    expect(runnable![1]).toBe(low![0]);
    expect(high).toBeNull();
    expect(g.edges).toEqual([low![0]]);
  });

  it('shades the whole box too low when the runnable range is above the chart, and too high when it is below', () => {
    const above = sparkGeometry(input({ min_level: 5, max_level: 6 }))!;
    expect(above.zones).toEqual({ runnable: null, low: [0, SPARK_H], high: null });
    expect(above.edges).toEqual([]);
    const below = sparkGeometry(input({ min_level: 0.01, max_level: 0.05 }))!;
    expect(below.zones).toEqual({ runnable: null, low: null, high: [0, SPARK_H] });
  });

  it('has a too-high zone only when there is a maximum, and no zones without thresholds', () => {
    const g = sparkGeometry(input({ min_level: 0.3, max_level: 0.7 }))!;
    expect(g.zones.high![0]).toBe(0);
    expect(g.zones.high![1]).toBe(g.zones.runnable![0]);
    expect(g.edges).toHaveLength(2);
    expect(sparkGeometry(input({ min_level: null, max_level: null }))!.zones).toEqual({ runnable: null, low: null, high: null });
  });

  it('leaves gaps unjoined and draws no outlook without one', () => {
    const levels = input().recent!.levels.map((v, i) => (i >= 16 && i <= 24 ? null : v));
    const g = sparkGeometry(input({ recent: { start: '2026-10-14T09:00:00.000Z', levels }, tomorrow: null }))!;
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
    expect(svg.querySelectorAll('.spark-runnable, .spark-low, .spark-edge, .spark-range, .spark-now, .spark-outlook, .spark-line, .spark-dot')).toHaveLength(8);
    expect(sparkline({ ...input(), stale: true })).toBeNull();
  });
});
