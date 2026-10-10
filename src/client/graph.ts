// River level graph with uPlot (lazy-loaded). Given rain, it adds a strip of rain bars hanging from
// the top and runs on past now: forecast rain, and the outlook as a curve inside its likely range.

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { GaugeOutlook, LevelPoint, LevelRange, RainSeries } from '../shared/types.ts';
import { h } from './dom.ts';
import { barScaleFloor, barSize, DAY, dayTotals, HOUR, outlookCurve, rainBars, recentSlope, ukMidnight } from './rainlayer.ts';
import { cssVar } from './theme.ts';

export interface GraphOptions {
  min?: number | null;
  max?: number | null;
  height?: number;
  /** Size the plot to the container's height (which must be set by the layout), following it as it changes. */
  fill?: boolean;
  /** Hourly rain at the gauge, past and forecast. */
  rain?: RainSeries | null;
  /** The gauge's outlook, drawn on from the latest reading when there is rain to run on with. */
  outlook?: GaugeOutlook | null;
  /** Length of the history period in days: sets the rain bar width and the time labels. */
  days?: number;
}

/** Height of the rain strip above the plot (CSS px). */
const RAIN_STRIP = 42;

export interface LevelGraph {
  destroy(): void;
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** UK-style time axis: "06:00", "Tue" at midnight, or "6 Oct" for long periods. */
const xValues =
  (days?: number) =>
  (u: uPlot, splits: number[]): string[] => {
    const long = days != null ? days > 7 : (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0) > 4 * 86400;
    return splits.map((s) => {
      const d = new Date(s * 1000);
      if (long) return dateFmt.format(d);
      if (d.getHours() === 0 && d.getMinutes() === 0) return dayFmt.format(d);
      return hourFmt.format(d);
    });
  };

const timeFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function levelGraph(el: HTMLElement, points: LevelPoint[], opts: GraphOptions = {}): LevelGraph {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const t = Date.parse(p.t);
    if (Number.isFinite(t) && Number.isFinite(p.v)) {
      xs.push(t / 1000);
      ys.push(p.v);
    }
  }
  const min = opts.min ?? null;
  const max = opts.max ?? null;
  const rain = opts.rain ?? null;
  const days = opts.days ?? 2;
  const now = Date.now();
  const today = ukMidnight(now);
  // With rain the graph runs on to the end of the day after tomorrow.
  const end = rain ? today + 3 * DAY : null;
  const last = points.length ? points[points.length - 1] : null;
  /** The outlook's predicted levels, placed at midday on their days. */
  const ahead: Array<{ name: string; t: number; r: LevelRange }> = [];
  if (rain && last && opts.outlook?.tomorrow) {
    ahead.push({ name: 'Tomorrow', t: today + DAY + 12 * HOUR, r: opts.outlook.tomorrow });
    const t = today + 2 * DAY + 12 * HOUR;
    if (opts.outlook.day_after) ahead.push({ name: dayFmt.format(t), t, r: opts.outlook.day_after });
  }
  let plot: uPlot | null = null;
  /** Plot height: fixed, or what the container leaves after everything else uPlot draws (the legend). */
  const plotHeight = () => {
    if (!opts.fill) return opts.height ?? (rain ? 270 : 220);
    const p = plot as uPlot | null;
    const extra = p ? Math.max(0, p.root.scrollHeight - p.height) : 32;
    return Math.max(rain ? 110 + 14 + RAIN_STRIP + 30 : 110, el.clientHeight - extra - 6);
  };

  function build(): void {
    plot?.destroy();
    const c = {
      line: cssVar('--loch') || '#1c6596',
      ink: cssVar('--ink-2') || '#4a5b63',
      rule: cssVar('--rule') || '#d5ddda',
      run: cssVar('--st-runnable') || '#0b7d6e',
      high: cssVar('--st-high') || '#a2306a',
      text: cssVar('--ink') || '#13242b',
      quiet: cssVar('--ink-3') || '#6b7c82',
      surface: cssVar('--surface') || '#ffffff',
      rain: cssVar('--rain') || '#6a72c9',
      rainDue: cssVar('--rain-due') || '#a7acdf',
    };
    const dpr = window.devicePixelRatio || 1;

    /** A threshold drawn on the chart, or, when it is off the scale, an arrowed label at that edge. */
    const hLine = (u: uPlot, v: number, color: string, label: string, below: boolean) => {
      const y = Math.round(u.valToPos(v, 'y', true));
      const { left, top, width, height } = u.bbox;
      if (y < top || y > top + height) {
        const above = y < top;
        const ctx = u.ctx;
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = above ? 'top' : 'bottom';
        ctx.fillText(`${label} ${above ? '↑' : '↓'}`, left + width - 6 * dpr, above ? top + 4 * dpr : top + height - 4 * dpr);
        ctx.restore();
        return;
      }
      const ctx = u.ctx;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = below ? 'top' : 'bottom';
      ctx.fillText(label, left + 6 * dpr, y + (below ? 4 : -4) * dpr);
      ctx.restore();
    };

    /** Rain bars in a strip above the plot, a line at now, and the outlook curve and its range. */
    const drawAhead = (u: uPlot) => {
      if (!rain) return;
      const ctx = u.ctx;
      const { left, top, width, height } = u.bbox;
      const X = (t: number) => u.valToPos(t / 1000, 'x', true);
      const from = (u.scales.x.min ?? 0) * 1000;
      const to = (u.scales.x.max ?? 0) * 1000;
      const narrow = width / dpr < 420;
      const stripTop = 6 * dpr;
      const stripH = RAIN_STRIP * dpr;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 0, width, top + height);
      ctx.clip();

      // Rain hangs from the top; rain still to come carries on below what has fallen, paler.
      const size = barSize(days);
      const bars = rainBars(rain, from, to, size, now);
      const scale = Math.max(barScaleFloor(size), ...bars.map((b) => b.mm + b.forecastMm));
      const room = stripH - 14 * dpr;
      for (const b of bars) {
        const xa = X(b.t);
        const full = X(b.t + b.size) - xa;
        const w = Math.max(1, full - (full > 4 * dpr ? dpr : 0));
        const fell = (b.mm / scale) * room;
        ctx.fillStyle = c.rain;
        ctx.fillRect(xa, stripTop, w, fell);
        ctx.fillStyle = c.rainDue;
        ctx.fillRect(xa, stripTop + fell, w, (b.forecastMm / scale) * room);
      }

      // Each day's total under its bars: the wettest days first, skipping any that would collide.
      ctx.font = `600 ${(narrow ? 10 : 11) * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const placed: number[] = [];
      const totals = dayTotals(rain, from, to, now).sort((a, b) => b.mm + b.forecastMm - (a.mm + a.forecastMm));
      for (const d of totals) {
        const mm = d.mm + d.forecastMm;
        if (mm < (days > 7 ? 8 : 1)) continue;
        const a = Math.max(d.start, from);
        const cx = X(a + (Math.min(d.start + DAY, to) - a) / 2);
        if (cx < left + 14 * dpr || cx > left + width - 14 * dpr || placed.some((p) => Math.abs(p - cx) < 40 * dpr)) continue;
        placed.push(cx);
        ctx.fillStyle = d.forecastMm > d.mm ? c.quiet : c.ink;
        ctx.fillText(`${Math.round(mm)} mm`, cx, stripTop + stripH);
      }

      const xn = Math.round(X(now)) + 0.5;
      if (xn > left && xn < left + width) {
        ctx.strokeStyle = c.text;
        ctx.lineWidth = dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(xn, stripTop);
        ctx.lineTo(xn, top + height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = c.text;
        ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Now', xn - 4 * dpr, top + height - 3 * dpr);
      }

      // The outlook: a curve on from the latest reading through each predicted level, inside a
      // fan of the likely range that opens from nothing at the latest reading.
      if (last && ahead.length) {
        const t0 = Date.parse(last.t);
        const slope = recentSlope(points);
        const curve = (pick: (r: LevelRange) => number) =>
          outlookCurve([[t0, last.v], ...ahead.map((a): [number, number] => [a.t, pick(a.r)])], slope).map(([t, v]) => [X(t), u.valToPos(v, 'y', true)]);
        const hiC = curve((r) => r.hi);
        const loC = curve((r) => r.lo);
        ctx.beginPath();
        hiC.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        for (let i = loC.length - 1; i >= 0; i--) ctx.lineTo(loC[i][0], loC[i][1]);
        ctx.closePath();
        ctx.fillStyle = withAlpha(c.line, 0.16);
        ctx.fill();
        ctx.beginPath();
        curve((r) => r.level).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Over 30 days the next two days are a sliver: the curve alone, no markers.
        if (days <= 7) {
          ahead.forEach(({ name, t, r }) => {
            const x = X(t);
            const y = u.valToPos(r.level, 'y', true);
            ctx.beginPath();
            ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = c.surface;
            ctx.fill();
            ctx.strokeStyle = c.text;
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();
            const label = narrow ? `${r.level.toFixed(2)} m` : `${name} ${r.level.toFixed(2)} m`;
            ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const half = ctx.measureText(label).width / 2;
            ctx.fillStyle = c.text;
            ctx.fillText(label, Math.min(left + width - half - 2 * dpr, x), y - 9 * dpr);
          });
        }
      }
      ctx.restore();

      ctx.fillStyle = c.quiet;
      ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('Rain', left - 8 * dpr, stripTop + stripH / 2);
    };

    /** The latest reading: a dot on the end of the line, labelled with its level. */
    const drawLatest = (u: uPlot) => {
      if (!last) return;
      const ctx = u.ctx;
      const { left, top, width } = u.bbox;
      const x = u.valToPos(Date.parse(last.t) / 1000, 'x', true);
      const y = u.valToPos(last.v, 'y', true);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = c.line;
      ctx.fill();
      ctx.strokeStyle = c.surface;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      const label = `${last.v.toFixed(2)} m`;
      ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      const w = ctx.measureText(label).width;
      // Up and to the left of the dot (the outlook runs on to the right), kept inside the plot.
      const lx = Math.max(left + 2 * dpr, x - 8 * dpr - w);
      const ly = Math.max(top + 14 * dpr, y - 8 * dpr);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = c.surface;
      ctx.strokeText(label, Math.min(lx, left + width - w), ly);
      ctx.fillStyle = c.text;
      ctx.fillText(label, Math.min(lx, left + width - w), ly);
      ctx.restore();
    };

    const options: uPlot.Options = {
      width: Math.max(260, el.clientWidth),
      height: plotHeight(),
      padding: [rain ? 14 + RAIN_STRIP : 14, 10, 0, 0],
      cursor: { drag: { x: false, y: false, setScale: false }, points: { size: 8 } },
      // No legend: its on/off box for the line only got in the way. The levels that matter are
      // labelled on the plot (the latest reading and the outlook).
      legend: { show: false },
      scales: {
        x: { time: true, range: (_u, dmin, dmax) => [dmin, end != null ? Math.max(dmax, end / 1000) : dmax] },
        y: {
          // Fit the readings (and the outlook's range); pull in a threshold only when it is near them,
          // so a distant "too high" line doesn't flatten the curve (it gets an edge label instead).
          range: (_u, dmin, dmax) => {
            if (!Number.isFinite(dmin) || !Number.isFinite(dmax)) return [0, 1];
            let lo = dmin;
            let hi = dmax;
            for (const { r } of ahead) {
              lo = Math.min(lo, r.lo);
              hi = Math.max(hi, r.hi);
            }
            const reach = Math.max(0.25, dmax - dmin);
            for (const t of [min, max]) {
              if (t == null || t < dmin - reach || t > dmax + reach) continue;
              lo = Math.min(lo, t);
              hi = Math.max(hi, t);
            }
            const pad = Math.max((hi - lo) * 0.12, 0.05);
            return [lo - pad, hi + pad];
          },
        },
      },
      axes: [
        { stroke: c.ink, grid: { stroke: c.rule, width: 1 }, ticks: { stroke: c.rule, width: 1 }, values: xValues(rain ? days : undefined) },
        {
          stroke: c.ink,
          grid: { stroke: c.rule, width: 1 },
          ticks: { stroke: c.rule, width: 1 },
          size: 52,
          values: (_u, vals) => vals.map((v) => `${v.toFixed(v !== 0 && Math.abs(v) < 1 ? 2 : 1)} m`),
        },
      ],
      series: [
        { label: 'Time', value: (_u, v) => (v == null ? '–' : timeFmt.format(new Date(v * 1000))) },
        {
          label: 'Level',
          stroke: c.line,
          width: 2,
          fill: withAlpha(c.line, 0.12),
          points: { show: false },
          value: (_u, v) => (v == null ? '–' : `${v.toFixed(2)} m`),
        },
      ],
      hooks: {
        drawClear: [
          (u) => {
            if (min == null && max == null) return;
            const { left, top, width, height } = u.bbox;
            const yTop = max != null ? Math.max(top, u.valToPos(max, 'y', true)) : top;
            const yBot = min != null ? Math.min(top + height, u.valToPos(min, 'y', true)) : top + height;
            if (yBot <= yTop) return;
            u.ctx.save();
            u.ctx.fillStyle = withAlpha(c.run, 0.1);
            u.ctx.fillRect(left, yTop, width, yBot - yTop);
            u.ctx.restore();
          },
        ],
        draw: [
          (u) => {
            const yMin = u.scales.y.min ?? 0;
            const yMax = u.scales.y.max ?? 0;
            // Both thresholds off the same edge: only label the nearer one.
            const bothAbove = min != null && max != null && min > yMax;
            const bothBelow = min != null && max != null && max < yMin;
            if (min != null && !bothBelow) hLine(u, min, c.run, `Runnable from ${min.toFixed(2)} m`, true);
            if (max != null && !bothAbove) hLine(u, max, c.high, `Too high above ${max.toFixed(2)} m`, false);
          },
          drawAhead,
          drawLatest,
        ],
      },
    };
    plot = new uPlot(options, [xs, ys], el);
    if (rain) {
      const narrow = el.clientWidth < 420;
      const start = Date.parse(rain.start);
      const due = rain.mm.some((mm, i) => mm > 0 && start + (i + 1) * HOUR > now);
      plot.root.append(
        h(
          'div',
          { class: 'graph-key', 'aria-hidden': 'true' },
          h('span', null, h('i', { class: 'k-rain' }), narrow ? 'Rain' : 'Rain at the gauge'),
          due ? h('span', null, h('i', { class: 'k-rain-due' }), 'Forecast rain') : null,
          ahead.length ? h('span', null, h('i', { class: 'k-outlook' }), narrow ? 'Outlook' : 'Outlook, likely range') : null,
        ),
      );
    }
  }

  build();
  const built = plot as uPlot | null; // assigned by build()
  if (opts.fill && built) built.setSize({ width: built.width, height: plotHeight() }); // the legend exists now
  const ro = new ResizeObserver(() => {
    if (!plot) return;
    const w = Math.max(260, el.clientWidth);
    const hgt = opts.fill ? plotHeight() : plot.height;
    if (Math.abs(plot.width - w) > 2 || Math.abs(plot.height - hgt) > 2) plot.setSize({ width: w, height: hgt });
  });
  ro.observe(el);
  const onTheme = () => build();
  document.addEventListener('rg:theme', onTheme);

  return {
    destroy() {
      ro.disconnect();
      document.removeEventListener('rg:theme', onTheme);
      plot?.destroy();
      plot = null;
    },
  };
}
