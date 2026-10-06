// Chat tools. Each one reads the same D1 data the pages use, so the
// assistant and the UI never disagree about a level or a status.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ChatCard, SectionSummary } from '../../shared/types.ts';
import { getGauge, getSection, listSections, searchGauges } from '../data.ts';
import { HISTORY_PERIODS, levelHistory } from '../poll.ts';
import { getWeather } from '../weather.ts';
import type { AppEnv } from '../env.ts';

export const REGIONS = ['Far North', 'North East', 'West Highlands', 'Central Highlands', 'Southern Uplands'] as const;

const inputs = {
  search_sections: z.object({
    query: z.string().max(100).optional(),
    region: z.enum(REGIONS).optional(),
    grade_min: z.number().min(1).max(6).optional(),
    grade_max: z.number().min(1).max(6).optional(),
    status: z.enum(['runnable', 'low', 'high', 'unknown']).optional(),
  }),
  get_section: z.object({ slug: z.string().max(120) }),
  get_gauge: z.object({ station_no: z.string().max(20) }),
  search_gauges: z.object({ query: z.string().min(2).max(60) }),
  get_weather: z.object({ slug: z.string().max(120) }),
  show_level_graph: z.object({ station_no: z.string().max(20), period: z.enum(HISTORY_PERIODS).optional() }),
};
export type ToolName = keyof typeof inputs;

const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'search_sections',
    description:
      'Find river sections. All filters are optional and combine. Returns up to 20 sections with slug, grade, region, current status and headline gauge reading. Use status "runnable" to answer what is running now.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words from the river or section name, e.g. "etive", "orchy upper"' },
        region: { type: 'string', enum: [...REGIONS] },
        grade_min: { type: 'number', description: 'Only sections whose grade range reaches at least this grade' },
        grade_max: { type: 'number', description: 'Only sections whose easiest grade is at most this grade' },
        status: { type: 'string', enum: ['runnable', 'low', 'high', 'unknown'] },
      },
    },
  },
  {
    name: 'get_section',
    description:
      'Full facts for one section by slug: grade, length, time, character, put-in/take-out, linked SEPA gauges with current level, trend, typical range, paddling thresholds and their confidence, plus private guide notes for grounding (never quote them). Also shows the section card to the user.',
    input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'get_gauge',
    description: 'One SEPA gauge by station number: current level, trend, typical range and the last 24 hours (min, max, first, last).',
    input_schema: { type: 'object', properties: { station_no: { type: 'string' } }, required: ['station_no'] },
  },
  {
    name: 'search_gauges',
    description: 'Find SEPA level gauges by gauge name, river or catchment. Returns up to 10 with current readings.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_weather',
    description: "Weather at a section's location: rain in the past 24 h, the next 24 h and 48 h, rainy hours, wind and temperature.",
    input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'show_level_graph',
    description: 'Show the user a level graph for a SEPA gauge. period: P1D, P2D (default), P7D or P30D.',
    input_schema: {
      type: 'object',
      properties: { station_no: { type: 'string' }, period: { type: 'string', enum: [...HISTORY_PERIODS] } },
      required: ['station_no'],
    },
  },
];

export const TOOLS: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }));

export const TOOL_STATUS: Record<ToolName, string> = {
  search_sections: 'Searching river sections',
  get_section: 'Reading the river section',
  get_gauge: 'Checking SEPA gauge',
  search_gauges: 'Searching SEPA gauges',
  get_weather: 'Checking the forecast',
  show_level_graph: 'Drawing level graph',
};

export interface ToolContext {
  env: AppEnv;
  ctx: ExecutionContext;
  emitCard: (card: ChatCard) => void;
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function compactSummary(s: SectionSummary) {
  return {
    slug: s.slug,
    name: s.name,
    grade: s.grade_text,
    region: s.region,
    status: s.status,
    status_basis: s.status_basis,
    gauge: s.gauge_name,
    level_m: s.level,
    trend: s.trend,
  };
}

const STATUS_ORDER = { runnable: 0, high: 1, low: 2, unknown: 3 };

async function run(name: ToolName, input: unknown, t: ToolContext): Promise<unknown> {
  const db = t.env.DB;
  switch (name) {
    case 'search_sections': {
      const q = inputs.search_sections.parse(input);
      const words = q.query ? fold(q.query).split(/\s+/).filter(Boolean) : [];
      const hits = (await listSections(db))
        .filter((s) => words.every((w) => fold(`${s.name} ${s.river}`).includes(w)))
        .filter((s) => !q.region || s.region === q.region)
        .filter((s) => q.grade_min == null || (s.grade_max ?? s.grade_min ?? 0) >= q.grade_min)
        .filter((s) => q.grade_max == null || (s.grade_min ?? 99) <= q.grade_max)
        .filter((s) => !q.status || s.status === q.status)
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
      return { total: hits.length, sections: hits.slice(0, 20).map(compactSummary) };
    }
    case 'get_section': {
      const { slug } = inputs.get_section.parse(input);
      const found = await getSection(db, slug);
      if (!found) return { error: `No section with slug "${slug}". Use search_sections to find slugs.` };
      t.emitCard({ kind: 'section', slug });
      const d = found.detail;
      return {
        ...d,
        links: d.links.map((l) => ({
          station_no: l.station_no,
          gauge: l.gauge.name,
          relation: l.relation,
          level_m: l.gauge.level,
          level_at: l.gauge.level_at,
          stale: l.gauge.stale,
          trend: l.gauge.trend,
          typical_range_m: [l.gauge.typical_low, l.gauge.typical_high],
          runnable_from_m: l.min_level,
          too_high_above_m: l.max_level,
          threshold_basis: l.basis,
          confidence: l.confidence,
          status: l.status,
          reason: l.reason,
        })),
        nearby_gauges: d.nearby_gauges.map((g) => ({ station_no: g.station_no, name: g.name, river: g.river, level_m: g.level })),
        guide_notes_for_grounding: found.guide,
      };
    }
    case 'get_gauge': {
      const { station_no } = inputs.get_gauge.parse(input);
      const g = await getGauge(db, station_no);
      if (!g) return { error: `No SEPA level gauge ${station_no}.` };
      const h = await levelHistory(g.station_no, g.ts_id, 'P1D', t.ctx);
      const vals = h.points.map((p) => p.v);
      const { ts_id: _ts, ...gauge } = g;
      return {
        ...gauge,
        last_24h: vals.length
          ? { min_m: Math.min(...vals), max_m: Math.max(...vals), first: h.points[0], last: h.points[h.points.length - 1] }
          : null,
      };
    }
    case 'search_gauges': {
      const { query } = inputs.search_gauges.parse(input);
      return { gauges: await searchGauges(db, query) };
    }
    case 'get_weather': {
      const { slug } = inputs.get_weather.parse(input);
      const found = await getSection(db, slug);
      if (!found || found.detail.lat == null || found.detail.lon == null) return { error: 'No location for that section.' };
      const w = await getWeather(found.detail.lat, found.detail.lon, t.ctx);
      const next24 = w.hours.slice(0, 24);
      return {
        rain_past_24h_mm: w.rain_past_24h_mm,
        rain_next_24h_mm: w.rain_next_24h_mm,
        rain_next_48h_mm: w.rain_next_48h_mm,
        max_wind_next_24h_kmh: Math.max(...next24.map((h) => h.wind_kmh)),
        temp_range_next_24h_c: [Math.min(...next24.map((h) => h.temp_c)), Math.max(...next24.map((h) => h.temp_c))],
        rainy_hours_next_48h: w.hours.filter((h) => h.rain_mm >= 0.5).slice(0, 16).map((h) => ({ time: h.time, rain_mm: h.rain_mm })),
      };
    }
    case 'show_level_graph': {
      const { station_no, period = 'P2D' } = inputs.show_level_graph.parse(input);
      const g = await getGauge(db, station_no);
      if (!g) return { error: `No SEPA level gauge ${station_no}.` };
      t.emitCard({ kind: 'graph', station_no, period, label: g.name });
      return { shown: true, gauge: g.name, period };
    }
  }
}

export function isToolName(name: string): name is ToolName {
  return name in inputs;
}

/** Runs a tool and returns a JSON string for the tool_result block; failures become error results. */
export async function executeTool(name: string, input: unknown, t: ToolContext): Promise<{ content: string; is_error: boolean }> {
  if (!isToolName(name)) return { content: JSON.stringify({ error: `Unknown tool ${name}` }), is_error: true };
  try {
    const out = JSON.stringify(await run(name, input, t));
    return { content: out.length > 16000 ? out.slice(0, 16000) + '…(truncated)' : out, is_error: false };
  } catch (err) {
    const msg = err instanceof z.ZodError ? `Invalid input: ${err.issues.map((i) => i.message).join('; ')}` : (err as Error).message;
    return { content: JSON.stringify({ error: msg }), is_error: true };
  }
}
