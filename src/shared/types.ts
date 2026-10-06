// API contract shared by the Worker and the browser client.

export type SectionStatus = 'low' | 'runnable' | 'high' | 'unknown';
export type TypicalStatus = 'below' | 'typical' | 'above' | 'unknown';
export type Trend = 'rising' | 'falling' | 'steady' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type Relation = 'on-section' | 'upstream' | 'downstream' | 'proxy';
/** Where a section's paddling thresholds came from. */
export type BandBasis = 'guide' | 'typical-relative' | 'manual';
/** How the headline status was decided. */
export type StatusBasis = 'manual' | 'estimate' | 'typical' | 'none';

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
  stale: boolean;
}

export interface SectionGaugeLink {
  station_no: string;
  relation: Relation;
  min_level: number | null;
  max_level: number | null;
  basis: BandBasis;
  confidence: Confidence;
  reason: string;
  gauge: Gauge;
  status: SectionStatus;
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
  ukrgb_url: string;
  source_updated: string | null;
  links: SectionGaugeLink[];
  nearby_gauges: Gauge[];
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
  show_full_guide_text: boolean;
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
