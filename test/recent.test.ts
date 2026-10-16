import { describe, expect, it } from 'vitest';
import { mergeRecent, toRecentLevels } from '../src/shared/recent.ts';

const H = 3_600_000;
const hour = (iso: string) => Date.parse(iso) / H;

describe('mergeRecent', () => {
  it('keeps one reading an hour, preferring the one on the hour', () => {
    const merged = mergeRecent(null, [
      ['2026-10-16T08:05:00.000Z', 0.41],
      ['2026-10-16T08:20:00.000Z', 0.42],
      ['2026-10-16T09:15:00.000Z', 0.44],
      ['2026-10-16T09:00:00.000Z', 0.43],
    ]);
    expect(merged).toEqual([
      [hour('2026-10-16T08:00:00Z'), 0.41],
      [hour('2026-10-16T09:00:00Z'), 0.43],
    ]);
  });

  it('reads SEPA times with an offset, and rounds to the millimetre', () => {
    expect(mergeRecent(null, [['2026-10-16T10:00:00.000+01:00', 0.12345]])).toEqual([[hour('2026-10-16T09:00:00Z'), 0.123]]);
  });

  it('keeps stored hours, replaces an hour with its on-the-hour reading, and drops hours over two days old', () => {
    const stored: Array<[number, number]> = [
      [hour('2026-10-14T08:00:00Z'), 0.3],
      [hour('2026-10-14T10:00:00Z'), 0.31],
      [hour('2026-10-16T09:00:00Z'), 0.5],
    ];
    const merged = mergeRecent(stored, [
      ['2026-10-16T09:15:00.000Z', 0.52],
      ['2026-10-16T10:00:00.000Z', 0.55],
    ]);
    expect(merged).toEqual([
      [hour('2026-10-14T10:00:00Z'), 0.31],
      [hour('2026-10-16T09:00:00Z'), 0.5],
      [hour('2026-10-16T10:00:00Z'), 0.55],
    ]);
  });

  it('is empty with nothing stored or fetched', () => {
    expect(mergeRecent(null, [])).toEqual([]);
  });
});

describe('toRecentLevels', () => {
  it('lists one level per hour from the first, with gaps as null', () => {
    expect(
      toRecentLevels([
        [hour('2026-10-16T07:00:00Z'), 0.4],
        [hour('2026-10-16T09:00:00Z'), 0.5],
      ]),
    ).toEqual({ start: '2026-10-16T07:00:00.000Z', levels: [0.4, null, 0.5] });
    expect(toRecentLevels([])).toBeNull();
    expect(toRecentLevels(null)).toBeNull();
  });
});
