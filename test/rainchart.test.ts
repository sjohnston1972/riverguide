import { describe, expect, it } from 'vitest';
import { intensity, rainSpells, rainSummary, scaleMax } from '../src/client/rainchart.ts';
import type { WeatherHour } from '../src/shared/types.ts';

// 48 hours from 12:00 UTC on a winter day (UK time = UTC), with rain at the given hour offsets.
const forecast = (rain: Record<number, number>): WeatherHour[] =>
  Array.from({ length: 48 }, (_, i) => ({
    time: new Date(Date.parse('2026-12-03T12:00:00Z') + i * 3_600_000).toISOString(),
    temp_c: 6,
    rain_mm: rain[i] ?? 0,
    wind_kmh: 10,
  }));

describe('intensity / scaleMax', () => {
  it('uses Met Office rain-rate bands', () => {
    expect(intensity(0.2)).toBe('slight');
    expect(intensity(0.5)).toBe('moderate');
    expect(intensity(4)).toBe('heavy');
  });
  it('never scales below 2 mm/h and doubles above', () => {
    expect(scaleMax(0.3)).toBe(2);
    expect(scaleMax(1.5)).toBe(2);
    expect(scaleMax(2.5)).toBe(4);
    expect(scaleMax(9)).toBe(16);
  });
});

describe('rainSpells', () => {
  it('joins spells across short dry gaps and splits on long ones', () => {
    const s = rainSpells(forecast({ 5: 1, 6: 0.5, 8: 0.2, 20: 0.4 }));
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ start: 5, end: 8, peak: 1, peakAt: 5 });
    expect(s[0].total).toBeCloseTo(1.7);
  });
});

describe('rainSummary', () => {
  it('says when it stays dry', () => {
    expect(rainSummary(forecast({}))).toBe('Dry for the next 48 hours.');
  });
  it('describes the first spell of rain and when it clears', () => {
    // 19:00 to 21:00 Thu 3 Dec, peaking 1.5 mm/h at 20:00
    expect(rainSummary(forecast({ 7: 0.4, 8: 1.5, 9: 0.6 }))).toBe(
      'Dry until 19:00, then 2.5 mm over 3 hours, heaviest 1.5 mm/h (moderate) around 20:00. Dry from 22:00.',
    );
  });
  it('does not let drizzle lead the summary', () => {
    expect(rainSummary(forecast({ 2: 0.1, 29: 3, 30: 4.5, 31: 2 }))).toBe(
      'Mostly dry until Fri 17:00, then 9.5 mm over 3 hours, heaviest 4.5 mm/h (heavy) around Fri 18:00. Dry from Fri 20:00.',
    );
    expect(rainSummary(forecast({ 3: 0.1, 4: 0.2 }))).toBe('Mostly dry: just 0.3 mm of light drizzle in the next 48 hours.');
  });

  it('handles rain now and later spells on another day', () => {
    expect(rainSummary(forecast({ 0: 0.3, 1: 0.3, 30: 2, 31: 1 }))).toBe(
      'Raining now until about 14:00: 0.6 mm over 2 hours, heaviest 0.3 mm/h (slight) around 12:00. More rain from Fri 18:00 (3.0 mm in total).',
    );
  });
});
