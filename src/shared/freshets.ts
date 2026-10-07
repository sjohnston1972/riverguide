// Hydro dam releases ("freshets") from SSE's freshet schedule, which SEPA
// publishes each year as a spreadsheet. Each release has a start and end time
// (UK local) and a volume; volume / duration gives its average flow.

import type { OdsCell, OdsSheets } from './ods.ts';

export const FRESHET_PAGE = 'https://beta.sepa.scot/topics/water/water-levels/hydropower-scheme-water-releases/';

export interface FreshetRelease {
  /** Location as written in the schedule, e.g. "Garry (Invergarry)". */
  location: string;
  /** UK local time, "YYYY-MM-DDTHH:MM". */
  start: string;
  end: string;
  volume_m3: number;
  hours: number;
}

export interface FreshetSource {
  /** Stable id stored with each release. */
  key: string;
  /** Matches the schedule's location description. */
  match: RegExp;
  /** Display name, e.g. "River Garry". */
  river: string;
  dam: string;
  /** The schedule's volume already includes the river's compensation flow. */
  includes_compensation?: boolean;
  /** Sections downstream that the release runs through. */
  sections: Array<{ slug: string; note?: string }>;
}

/** Every release location in the schedule, with the sections each one feeds (if we list any). */
export const FRESHET_SOURCES: FreshetSource[] = [
  { key: 'garry', match: /^garry \(invergarry\)/i, river: 'River Garry', dam: 'Invergarry dam', sections: [{ slug: 'river-garry' }] },
  {
    key: 'moriston',
    match: /^dundreggan/i,
    river: 'River Moriston',
    dam: 'Dundreggan dam',
    sections: [
      { slug: 'river-moriston-upper-section' },
      { slug: 'river-moriston-middle-section' },
      { slug: 'river-moriston-lower-section', note: 'Released from Dundreggan dam, about 6 km upstream.' },
    ],
  },
  { key: 'moriston-cluanie', match: /^cluanie/i, river: 'Upper Moriston', dam: 'Cluanie dam', sections: [] },
  {
    key: 'lyon',
    match: /^stronuich/i,
    river: 'River Lyon',
    dam: 'Stronuich dam',
    sections: [
      { slug: 'river-lyon-bridge-of-balgie', note: 'Released from Stronuich dam, about 7 km upstream.' },
      { slug: 'river-lyon', note: 'Released from Stronuich dam, about 20 km upstream, so the water takes some hours to arrive.' },
    ],
  },
  { key: 'tummel-lower', match: /^clunie/i, river: 'River Tummel (lower)', dam: 'Clunie dam', sections: [{ slug: 'river-tummel-loch-tummel-to-loch-faskally' }] },
  {
    key: 'tummel-upper',
    match: /^dunalastair/i,
    river: 'River Tummel (upper)',
    dam: 'Dunalastair dam',
    includes_compensation: true,
    sections: [{ slug: 'river-tummel-dunalastair-water-to-loch-tummel' }],
  },
  { key: 'awe', match: /^loch awe barrage/i, river: 'River Awe', dam: 'Loch Awe barrage', sections: [{ slug: 'river-awe' }] },
  { key: 'meig', match: /^meig\b/i, river: 'River Meig', dam: 'Meig dam', sections: [{ slug: 'river-meig-gorge' }] },
  { key: 'conon', match: /^luichart/i, river: 'River Conon', dam: 'Luichart dam', sections: [] },
  { key: 'farrar', match: /^beannachran/i, river: 'River Farrar', dam: 'Beannachran dam', sections: [] },
  { key: 'shira', match: /^river shira/i, river: 'River Shira', dam: 'Shira dam', sections: [] },
];

export function freshetSource(key: string): FreshetSource | null {
  return FRESHET_SOURCES.find((s) => s.key === key) ?? null;
}

export function freshetSourceFor(slug: string): { source: FreshetSource; note: string | null } | null {
  for (const source of FRESHET_SOURCES) {
    const s = source.sections.find((x) => x.slug === slug);
    if (s) return { source, note: s.note ?? null };
  }
  return null;
}

/** Source key for a schedule location; unknown locations get a key from their name so nothing is dropped. */
export function sourceKey(location: string): string {
  return FRESHET_SOURCES.find((s) => s.match.test(location))?.key ?? location.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Average flow a release adds, in m³/s. */
export function cumecs(volume_m3: number, hours: number): number {
  return hours > 0 ? volume_m3 / (hours * 3600) : 0;
}

const COLUMNS = {
  location: /location/i,
  startDate: /start date/i,
  startTime: /start time/i,
  endDate: /end date/i,
  endTime: /end time/i,
  volume: /volume/i,
  hours: /duration/i,
} as const;

/** Reads the release list (the sheet with a "Release Start Date" header) from the schedule spreadsheet. */
export function parseFreshetSchedule(sheets: OdsSheets): FreshetRelease[] {
  for (const rows of sheets.values()) {
    const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.startDate.test(c.text)));
    if (headerAt < 0) continue;
    const header = rows[headerAt].map((c) => c.text);
    const col = Object.fromEntries(
      Object.entries(COLUMNS).map(([k, re]) => [k, header.findIndex((h) => re.test(h))]),
    ) as Record<keyof typeof COLUMNS, number>;
    if (col.location < 0 || col.startDate < 0 || col.endDate < 0 || col.volume < 0) continue;

    const out: FreshetRelease[] = [];
    for (const r of rows.slice(headerAt + 1)) {
      const location = r[col.location]?.text.trim();
      const start = dateTime(r[col.startDate], r[col.startTime]);
      const end = dateTime(r[col.endDate], r[col.endTime]);
      const volume_m3 = num(r[col.volume]);
      if (!location || !start || !end || end <= start || volume_m3 == null || volume_m3 <= 0) continue;
      const hours = num(r[col.hours]) ?? (Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 3_600_000;
      out.push({ location, start, end, volume_m3, hours });
    }
    return out;
  }
  return [];
}

function num(c: OdsCell | undefined): number | null {
  if (!c) return null;
  const v = Number(c.value ?? c.text.replace(/,/g, ''));
  return Number.isFinite(v) && (c.value != null || c.text.trim() !== '') ? v : null;
}

/** Combines a date cell and a time cell into "YYYY-MM-DDTHH:MM" (local time, as written). */
function dateTime(date: OdsCell | undefined, time: OdsCell | undefined): string | null {
  const d = date?.value?.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!d) return null;
  const t = time?.text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
  let hh: number;
  let mm: number;
  if (t) {
    hh = Number(t[1]) % 12;
    if (!t[3]) hh = Number(t[1]);
    else if (t[3].toUpperCase() === 'PM') hh += 12;
    mm = Number(t[2]);
  } else {
    hh = Number(d[2] ?? 0);
    mm = Number(d[3] ?? 0);
  }
  return `${d[1]}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Rows to store: one per release, keyed by source. */
export function freshetRows(releases: FreshetRelease[]): Array<FreshetRelease & { source: string }> {
  return releases.map((r) => ({ ...r, source: sourceKey(r.location) }));
}

/** Schedule spreadsheet links on SEPA's page, with their year, newest first. */
export function scheduleLinks(html: string, pageUrl = FRESHET_PAGE): Array<{ year: number; url: string }> {
  const seen = new Map<number, string>();
  for (const m of html.matchAll(/href="([^"]*freshet-schedule-(\d{4})\.ods)"/gi)) {
    const year = Number(m[2]);
    if (!seen.has(year)) seen.set(year, new URL(m[1].replace(/&amp;/g, '&'), pageUrl).toString());
  }
  return [...seen].map(([year, url]) => ({ year, url })).sort((a, b) => b.year - a.year);
}

/** Current UK local time as "YYYY-MM-DDTHH:MM", comparable with stored release times. */
export function ukLocalNow(now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "Release today" means water in the river at some point between 08:00 and 20:00 UK time. */
export function paddlingWindow(day: string): { from: string; to: string } {
  return { from: `${day}T08:00`, to: `${day}T20:00` };
}

/**
 * Downloads and parses the current schedules from SEPA's page: this year's,
 * plus next year's once published. Throws if the page or a file can't be read.
 */
export async function loadFreshetSchedules(
  readOds: (data: ArrayBuffer) => Promise<OdsSheets>,
  now = new Date(),
): Promise<{ years: number[]; releases: FreshetRelease[] }> {
  const page = await fetch(FRESHET_PAGE, { headers: { 'user-agent': 'RiverGuide/1.0 (+https://riverguide.clydeford.net)' } });
  if (!page.ok) throw new Error(`SEPA releases page ${page.status}`);
  const thisYear = now.getUTCFullYear();
  const links = scheduleLinks(await page.text()).filter((l) => l.year >= thisYear);
  if (!links.length) throw new Error('No current freshet schedule linked from SEPA releases page');
  const releases: FreshetRelease[] = [];
  for (const l of links) {
    const res = await fetch(l.url);
    if (!res.ok) throw new Error(`Freshet schedule ${l.year}: ${res.status}`);
    const parsed = parseFreshetSchedule(await readOds(await res.arrayBuffer()));
    if (!parsed.length) throw new Error(`Freshet schedule ${l.year}: no releases found (format changed?)`);
    releases.push(...parsed.filter((r) => r.start.startsWith(String(l.year))));
  }
  return { years: links.map((l) => l.year), releases };
}
