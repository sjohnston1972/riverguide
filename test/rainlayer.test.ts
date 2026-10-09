import { describe, expect, it } from "vitest";
import {
  barSize,
  DAY,
  dayTotals,
  HOUR,
  outlookCurve,
  rainBars,
  rainBetween,
  recentSlope,
  ukMidnight,
} from "../src/client/rainlayer.ts";
import type { RainSeries } from "../src/shared/types.ts";

// 9 October 2026 is BST: UK midnight is 23:00 UTC the evening before.
const series = (start: string, mm: number[]): RainSeries => ({
  station_no: "1",
  period: "P2D",
  start,
  mm,
});

describe("ukMidnight", () => {
  it("finds the UK day start in summer time and winter time", () => {
    expect(
      new Date(ukMidnight(Date.parse("2026-10-09T08:15:00Z"))).toISOString(),
    ).toBe("2026-10-08T23:00:00.000Z");
    expect(
      new Date(ukMidnight(Date.parse("2026-12-09T08:15:00Z"))).toISOString(),
    ).toBe("2026-12-09T00:00:00.000Z");
  });
});

describe("rainBars", () => {
  const rain = series("2026-10-08T23:00:00Z", [1, 2, 0, 0, 0, 0, 3, 0.5]);
  const now = Date.parse("2026-10-09T06:30:00Z");

  it("keeps hourly bars and splits off rain still to come", () => {
    const bars = rainBars(
      rain,
      Date.parse(rain.start),
      Date.parse(rain.start) + DAY,
      HOUR,
      now,
    );
    expect(bars.map((b) => [b.mm, b.forecastMm])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 0.5],
    ]);
  });

  it("groups into 6-hour bars from UK midnight", () => {
    const bars = rainBars(
      rain,
      Date.parse(rain.start),
      Date.parse(rain.start) + DAY,
      barSize(7),
      now,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({
      t: Date.parse("2026-10-08T23:00:00Z"),
      mm: 3,
      forecastMm: 0,
    });
    expect(bars[1]).toMatchObject({
      t: Date.parse("2026-10-09T05:00:00Z"),
      mm: 3,
      forecastMm: 0.5,
    });
  });

  it("totals by UK day and sums whole hours in a window", () => {
    expect(
      dayTotals(
        rain,
        Date.parse(rain.start),
        Date.parse(rain.start) + DAY,
        now,
      ),
    ).toEqual([
      { start: Date.parse("2026-10-08T23:00:00Z"), mm: 6, forecastMm: 0.5 },
    ]);
    expect(rainBetween(rain, Date.parse(rain.start), now)).toBe(6);
  });
});

describe("recentSlope", () => {
  it("is the change per hour over the last three hours", () => {
    const pts = [0, 1, 2, 3, 4].map((h) => ({
      t: new Date(Date.parse("2026-10-09T00:00:00Z") + h * HOUR).toISOString(),
      v: 0.7 + h * 0.01,
    }));
    expect(recentSlope(pts)).toBeCloseTo(0.01, 6);
    expect(recentSlope(pts.slice(0, 1))).toBe(0);
  });
});

describe("outlookCurve", () => {
  const t0 = Date.parse("2026-10-09T08:00:00Z");
  const knots: Array<[number, number]> = [
    [t0, 0.76],
    [t0 + 28 * HOUR, 0.77],
    [t0 + 52 * HOUR, 0.74],
  ];

  it("passes through every knot", () => {
    const c = outlookCurve(knots, 0.003, 24);
    for (const [t, v] of knots) {
      const p = c.find(([ct]) => Math.abs(ct - t) < 1);
      expect(p?.[1]).toBeCloseTo(v, 9);
    }
  });

  it("leaves the latest reading at the river’s current rate and has no kink at the middle knot", () => {
    const c = outlookCurve(knots, 0.003, 2400);
    const slope = (i: number) =>
      (c[i + 1][1] - c[i][1]) / ((c[i + 1][0] - c[i][0]) / HOUR);
    expect(slope(0)).toBeCloseTo(0.003, 4);
    const mid = c.findIndex(([t]) => Math.abs(t - knots[1][0]) < 1);
    expect(slope(mid - 1)).toBeCloseTo(slope(mid), 5);
    // Curvature matches either side of the knot too (C2).
    const bend = (i: number) =>
      (slope(i + 1) - slope(i)) / ((c[i + 1][0] - c[i][0]) / HOUR);
    expect(bend(mid - 2) / bend(mid)).toBeCloseTo(1, 1);
  });
});
