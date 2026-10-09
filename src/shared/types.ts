// API contract shared by the Worker and the browser client.

import type { LoraEbb } from './tides.ts';

export type { LoraEbb };

export type SectionStatus = 'low' | 'runnable' | 'high' | 'unknown';
export type TypicalStatus = 'below' | 'typical' | 'above' | 'unknown';
export type Trend = 'rising' | 'falling' | 'steady' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type Relation = 'on-section' | 'upstream' | 'downstream' | 'proxy';
/**
 * Where a section's paddling thresholds came from:
 * guide = metres stated in the guidebook; duration = guidebook wording mapped onto how often the gauge
 * reaches each level; typical-relative = wording mapped onto SEPA's typical range (gauges without a curve).
 */
export type BandBasis = 'guide' | 'duration' | 'typical-relative' | 'paddler' | 'community' | 'manual';
/** How the headline status was decided. */
export type StatusBasis = 'manual' | 'community' | 'paddler' | 'estimate' | 'typical' | 'none';

/** Paddler-set thresholds (metres) from Where's the Water: the level at which each step starts. */
export interface PaddlerLevels {
  scrape: number;
  low: number;
  medium: number;
  high: number;
  very_high: number;
  huge: number;
}
export type PaddlerStep = 'empty' | 'scrape' | 'low' | 'medium' | 'high' | 'very_high' | 'huge';

export interface Gauge {
  station_no: string;
  name: string;
  river: string | null;
  catchment: string | null;
  lat: number;
  lon: number;
  level: number | null;
  level_at: string | null;
  trend: Trend;
  /** SEPA median annual minimum / maximum level. */
  typical_low: number | null;
  typical_high: number | null;
  typical_status: TypicalStatus;
  /** Share of days (from three years of daily maxima) on which the current level is reached; null without a curve. */
  days_reached_pct: number | null;
  stale: boolean;
  /** Where the level is heading over the next two days; null without rain data or a current reading. */
  outlook: GaugeOutlook | null;
}

export interface LevelRange {
  level: number;
  lo: number;
  hi: number;
}

export interface GaugeOutlook {
  /** model: predicted from this gauge's fitted rain response; trend: only a direction from the trend and rain. */
  basis: 'model' | 'trend';
  direction: 'rise' | 'fall' | 'steady';
  /** Predicted daily peak tomorrow and the day after (model basis only). */
  tomorrow: LevelRange | null;
  day_after: LevelRange | null;
  /** Forecast rain at the gauge today (rest of day included) and tomorrow, mm. */
  rain_today_mm: number;
  rain_tomorrow_mm: number;
  /** When the outlook was computed (ISO). */
  at: string;
}

export interface SectionGaugeLink {
  station_no: string;
  relation: Relation;
  min_level: number | null;
  max_level: number | null;
  basis: BandBasis;
  confidence: Confidence;
  reason: string;
  /** Where's the Water's calibration graph for these paddler levels, when there is one. */
  calibration_url: string | null;
  gauge: Gauge;
  status: SectionStatus;
  /** Status and paddler step at the predicted level tomorrow (model outlook only). */
  status_tomorrow: SectionStatus | null;
  step_tomorrow: PaddlerStep | null;
  /** Paddler level scale for this gauge, when Where's the Water has one. */
  levels: PaddlerLevels | null;
  /** Where the current reading sits on that scale. */
  step: PaddlerStep | null;
}

export interface SectionSummary {
  slug: string;
  name: string;
  river: string;
  region: string;
  grade_text: string;
  grade_min: number | null;
  grade_max: number | null;
  lat: number | null;
  lon: number | null;
  location_precision: 'grid' | 'approx' | null;
  status: SectionStatus;
  status_basis: StatusBasis;
  /** Confidence of the headline thresholds, when the status is an estimate or manual. */
  status_confidence: Confidence | null;
  /** Headline gauge reading, when one is linked. */
  station_no: string | null;
  gauge_name: string | null;
  level: number | null;
  level_at: string | null;
  stale: boolean;
  trend: Trend;
  /** Paddler scale step of the headline reading (e.g. "medium"), when available. */
  step: PaddlerStep | null;
  /** A scheduled dam release or tidal window falls today (UK date). */
  release_today: boolean;
  /** Headline gauge outlook: direction, and tomorrow's status where a model prediction exists. */
  outlook: 'rise' | 'fall' | 'steady' | null;
  status_tomorrow: SectionStatus | null;
  step_tomorrow: PaddlerStep | null;
}

export interface PlacePoint {
  lat: number;
  lon: number;
  label: string;
  precision?: 'grid' | 'approx';
}

export interface GuideText {
  description: string;
  hazards: string;
  access: string;
  water_level: string;
  other: string;
}

export interface SectionDetail extends SectionSummary {
  length_text: string | null;
  time_text: string | null;
  character: string | null;
  put_in: PlacePoint | null;
  take_out: PlacePoint | null;
  source_updated: string | null;
  links: SectionGaugeLink[];
  nearby_gauges: Gauge[];
  /** 'wtw' when the section itself comes from Where's the Water. */
  source: 'guidebook' | 'wtw';
  /** Upcoming scheduled release days (YYYY-MM-DD, UK), soonest first (Where's the Water; used where SEPA has no schedule). */
  releases: string[];
  release_note: string | null;
  /** Hydro dam releases from SEPA's freshet schedule, when the section is below a scheduled dam. */
  dam_schedule: DamSchedule | null;
  /** Falls of Lora only: predicted working ebbs for the next fortnight. */
  tide_ebbs: LoraEbb[] | null;
  /** Only present when the site is configured to show full guide text. */
  guide?: GuideText;
}

export interface LevelPoint {
  t: string;
  v: number;
}

export interface LevelHistory {
  station_no: string;
  period: string;
  points: LevelPoint[];
}

/** Hourly rain at a gauge (Open-Meteo), from the start of a history period to the end of the day after tomorrow. */
export interface RainSeries {
  station_no: string;
  period: string;
  /** The first hour (UTC); each value is the rain in the hour starting there, then one hour on. */
  start: string;
  mm: number[];
}

export interface WeatherHour {
  time: string;
  temp_c: number;
  rain_mm: number;
  wind_kmh: number;
}

export interface Weather {
  lat: number;
  lon: number;
  rain_past_24h_mm: number;
  rain_next_24h_mm: number;
  rain_next_48h_mm: number;
  hours: WeatherHour[];
}

export interface PublicConfig {
  turnstile_site_key: string | null;
  chat_enabled: boolean;
  community_enabled: boolean;
  show_full_guide_text: boolean;
}

// ---- Community level reports ----

export type Verdict = 'too_low' | 'scrapy' | 'good' | 'pushy' | 'too_high';

export interface CommunityReport {
  id: string;
  station_no: string | null;
  gauge_name: string | null;
  paddled_at: string;
  level: number | null;
  verdict: Verdict;
  /** Null when there is no note or it was hidden after flags. */
  note: string | null;
  created_at: string;
  agrees: number;
  disagrees: number;
  /** This device's vote: 1, -1 or 0. */
  my_vote: number;
  mine: boolean;
}

export interface CommunityBandInfo {
  station_no: string;
  min_level: number | null;
  max_level: number | null;
  reports: number;
  people: number;
  confidence: Confidence;
}

export interface CommunityReports {
  reports: CommunityReport[];
  band: CommunityBandInfo | null;
  /** Evidence so far towards a community band, and what is required. */
  progress: { reports: number; people: number; days: number; need: { reports: number; people: number; days: number } };
  /** Whether this device has passed the bot check (it can then report and vote). */
  verified: boolean;
  enabled: boolean;
}

export interface NewReport {
  verdict: Verdict;
  /** ISO time the section was paddled; within the last 7 days. */
  paddled_at: string;
  note?: string;
}

// ---- Chat (POST /api/chat, Server-Sent Events) ----

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
  /** Section the user is looking at, if any. */
  context_slug?: string;
}

export type ChatCard =
  | { kind: 'section'; slug: string }
  | { kind: 'graph'; station_no: string; period: string; label: string };

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; label: string }
  | { type: 'card'; card: ChatCard }
  | { type: 'error'; message: string }
  | { type: 'done' };


export interface DamRelease {
  /** UK local time, "YYYY-MM-DDTHH:MM". */
  start: string;
  end: string;
  hours: number;
  volume_m3: number;
  /** Average flow added by the release, m³/s. */
  cumecs: number;
}

export interface DamSchedule {
  key: string;
  river: string;
  dam: string;
  /** Section-specific note, e.g. distance from the dam. */
  note: string | null;
  /** The volume includes the river's compensation flow (otherwise it is on top of it). */
  includes_compensation: boolean;
  /** Upcoming and running releases, soonest first. */
  releases: DamRelease[];
}

export interface ReleasesOverview {
  dams: Array<DamSchedule & { sections: Array<{ slug: string; name: string; grade_text: string }> }>;
  source_url: string;
}

export interface LoraOverview {
  ebbs: LoraEbb[];
  /** Tide-table range thresholds, metres. */
  min_range: number;
  big_range: number;
  station: string;
}
