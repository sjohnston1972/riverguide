// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Gauge, SectionGaugeLink } from '../src/shared/types.ts';
import { bandBar } from '../src/client/bandbar.ts';
import { cumecsText, damReleaseRow } from '../src/client/schedule.ts';

const gauge = (over: Partial<Gauge> = {}): Gauge =>
  ({ station_no: '1', name: 'Test', level: 0.8, level_at: '2026-10-08T12:00:00Z', stale: false, trend: 'steady', typical_low: 0.2, typical_high: 1.8, outlook: null, ...over }) as Gauge;

const link = (over: Partial<SectionGaugeLink> = {}): SectionGaugeLink =>
  ({ station_no: '1', relation: 'on-section', min_level: 0.5, max_level: 1.5, basis: 'duration', confidence: 'medium', levels: null, step: null, step_tomorrow: null, gauge: gauge(), ...over }) as SectionGaugeLink;

/** Left offset (%) of an element positioned by the bar. */
const left = (el: Element | null) => Number.parseFloat((el as HTMLElement).style.left);
const width = (el: Element | null) => Number.parseFloat((el as HTMLElement).style.width);

describe('bandBar', () => {
  it('lays out low / runnable / high zones that tile the bar, with the marker inside the runnable zone', () => {
    const bar = bandBar(link())!;
    const [low, run, high] = ['.bb-low', '.bb-run', '.bb-high'].map((c) => bar.querySelector(c));
    expect(left(low)).toBeCloseTo(0, 1);
    expect(left(run)).toBeCloseTo(left(low) + width(low), 1);
    expect(left(high)).toBeCloseTo(left(run) + width(run), 1);
    expect(left(high) + width(high)).toBeCloseTo(100, 1);
    const now = left(bar.querySelector('.bb-marker'));
    expect(now).toBeGreaterThan(left(run));
    expect(now).toBeLessThan(left(high));
    expect(bar.getAttribute('aria-label')).toBe('Current level 0.80 m. Runnable between 0.50 m and 1.50 m. Typical range 0.20 m to 1.80 m.');
  });

  it('shows no marker for a stale reading, and nothing at all with no band and no typical range', () => {
    expect(bandBar(link({ gauge: gauge({ stale: true }) }))!.querySelector('.bb-marker')).toBeNull();
    expect(bandBar(link({ min_level: null, max_level: null, gauge: gauge({ typical_low: null, typical_high: null }) }))).toBeNull();
  });

  it("draws the paddler scale as steps and highlights now and tomorrow on the ladder", () => {
    const levels = { scrape: 0.4, low: 0.6, medium: 0.8, high: 1.0, very_high: 1.4, huge: 1.8 };
    const el = bandBar(link({ basis: 'paddler', levels, step: 'medium', step_tomorrow: 'high' }))!;
    expect(el.querySelectorAll('.bb-step')).toHaveLength(7);
    expect(el.querySelector('.bb-run')).toBeNull();
    expect(el.querySelector('[aria-current="true"] .step-chip-name')?.textContent).toBe('Medium');
    expect(el.querySelector('.step-chip-next')?.closest('li')?.classList.contains('s-high')).toBe(true);
  });

  it("adds tomorrow's predicted level when there is a model outlook", () => {
    const outlook = { basis: 'model', direction: 'rise', tomorrow: { level: 1.2, lo: 0.9, hi: 1.6 }, day_after: null, rain_today_mm: 10, rain_tomorrow_mm: 12, at: '' } as const;
    const bar = bandBar(link({ gauge: gauge({ outlook }) }))!;
    expect(bar.querySelector('.bb-pill-tomorrow')?.textContent).toBe('Tomorrow 1.20 m');
    expect(left(bar.querySelector('.bb-fc-marker'))).toBeGreaterThan(left(bar.querySelector('.bb-marker')));
    expect(bar.getAttribute('aria-label')).toContain('Tomorrow about 1.20 m, likely 0.90 m to 1.60 m.');
  });
});

describe('schedule rows', () => {
  it('formats release sizes: whole numbers from 10, one decimal below', () => {
    expect(cumecsText(12.345)).toBe('12 m³/s');
    expect(cumecsText(4)).toBe('4 m³/s');
    expect(cumecsText(4.25)).toBe('4.3 m³/s');
    expect(cumecsText(0.3)).toBe('0.3 m³/s');
  });

  it('labels today and tomorrow, and marks a release that is running now', () => {
    const running = damReleaseRow({ start: '2026-10-08T10:00', end: '2026-10-08T16:00', hours: 6, volume_m3: 216_000, cumecs: 10 }, '2026-10-08T12:00');
    expect(running.querySelector('.sched-day')?.textContent).toBe('Today');
    expect(running.querySelector('.sched-time')?.textContent).toBe('10:00 to 16:00');
    expect(running.querySelector('.sched-live')?.textContent).toBe('Running now');
    const later = damReleaseRow({ start: '2026-10-09T22:00', end: '2026-10-10T02:00', hours: 4, volume_m3: 1, cumecs: 1 }, '2026-10-08T12:00');
    expect(later.querySelector('.sched-day')?.textContent).toBe('Tomorrow');
    expect(later.querySelector('.sched-live')).toBeNull();
  });
});
