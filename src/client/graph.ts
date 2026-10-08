// River level graph with uPlot (lazy-loaded).

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { LevelPoint } from '../shared/types.ts';
import { cssVar } from './theme.ts';

export interface GraphOptions {
  min?: number | null;
  max?: number | null;
  height?: number;
  /** Size the plot to the container's height (which must be set by the layout), following it as it changes. */
  fill?: boolean;
}

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

/** UK-style time axis: "06:00", "Tue" at midnight, or "6 Oct" for long spans. */
function xValues(u: uPlot, splits: number[]): string[] {
  const span = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0);
  return splits.map((s) => {
    const d = new Date(s * 1000);
    if (span > 4 * 86400) return dateFmt.format(d);
    if (d.getHours() === 0 && d.getMinutes() === 0) return dayFmt.format(d);
    return hourFmt.format(d);
  });
}

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
  let plot: uPlot | null = null;
  /** Plot height: fixed, or what the container leaves after everything else uPlot draws (the legend). */
  const plotHeight = () => {
    if (!opts.fill) return opts.height ?? 220;
    const p = plot as uPlot | null;
    const extra = p ? Math.max(0, p.root.scrollHeight - p.height) : 32;
    return Math.max(110, el.clientHeight - extra - 6);
  };

  function build(): void {
    plot?.destroy();
    const c = {
      line: cssVar('--loch') || '#1c6596',
      ink: cssVar('--ink-2') || '#4a5b63',
      rule: cssVar('--rule') || '#d5ddda',
      run: cssVar('--st-runnable') || '#0b7d6e',
      high: cssVar('--st-high') || '#a2306a',
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

    const options: uPlot.Options = {
      width: Math.max(260, el.clientWidth),
      height: plotHeight(),
      padding: [14, 10, 0, 0],
      cursor: { drag: { x: false, y: false, setScale: false }, points: { size: 8 } },
      legend: { show: true, live: true },
      scales: {
        x: { time: true },
        y: {
          // Fit the readings; pull in a threshold only when it is near them, so a
          // distant "too high" line doesn't flatten the curve (it gets an edge label instead).
          range: (_u, dmin, dmax) => {
            if (!Number.isFinite(dmin) || !Number.isFinite(dmax)) return [0, 1];
            let lo = dmin;
            let hi = dmax;
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
        { stroke: c.ink, grid: { stroke: c.rule, width: 1 }, ticks: { stroke: c.rule, width: 1 }, values: xValues },
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
        ],
      },
    };
    plot = new uPlot(options, [xs, ys], el);
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
