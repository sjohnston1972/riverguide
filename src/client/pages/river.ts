// River section page.

import { distanceKm } from '../../shared/geo.ts';
import type { Gauge, GuideText, PlacePoint, SectionDetail, SectionGaugeLink, Weather } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { bandBar } from '../bandbar.ts';
import { errorBox, levelWithTrend, skeletonLines, statusPill } from '../components.ts';
import { clear, h, icon, safeUrl } from '../dom.ts';
import { lastListHref } from '../filters.ts';
import type { LevelGraph } from '../graph.ts';
import { ICONS } from '../icons.ts';
import {
  basisWording,
  characterLabel,
  ESTIMATE_TOOLTIP,
  formatDate,
  formatLevel,
  gradeLabel,
  RELATION_LABEL,
  relativeTime,
  TREND_LABEL,
  TYPICAL_LABEL,
} from '../labels.ts';
import type { AppCtx, Page } from '../main.ts';

const PERIODS: [string, string][] = [
  ['P2D', '2 days'],
  ['P7D', '7 days'],
  ['P30D', '30 days'],
];

type Place = PlacePoint & { precision?: string };

export function mountRiver(container: HTMLElement, slug: string, ctx: AppCtx): Page {
  const abort = new AbortController();
  const cleanups: (() => void)[] = [];
  let destroyed = false;

  const title = h('h1', { class: 'river-title' }, 'Loading river');
  const head = h('header', { class: 'river-head' }, h('a', { class: 'back-link', href: lastListHref() }, icon(ICONS.back), 'All rivers'), title);
  const body = h('div', { class: 'river-body' }, skeletonLines(3, 'skel-block'));
  container.append(h('article', { class: 'wrap river-page' }, head, body));
  ctx.setTitle('Loading');

  async function load(): Promise<void> {
    clear(body);
    body.append(skeletonLines(3, 'skel-block'));
    try {
      const d = await api.section(slug);
      if (destroyed) return;
      render(d);
    } catch (e) {
      if (destroyed) return;
      clear(body);
      if (e instanceof ApiError && e.status === 404) {
        title.textContent = 'River section not found';
        ctx.setTitle('Not found');
        body.append(h('div', { class: 'notice' }, h('p', null, "There's no section at this address. It may have been renamed."), h('p', null, h('a', { href: '/' }, 'Browse all rivers'))));
      } else {
        title.textContent = 'River section';
        body.append(errorBox("Couldn't load this river section. Check your connection and try again.", () => void load()));
      }
    }
  }

  function render(d: SectionDetail): void {
    ctx.setTitle(d.name);
    title.textContent = d.name;
    const sub = [d.river !== d.name ? d.river : null, d.region].filter(Boolean).join(', ');
    head.querySelector('.river-sub')?.remove();
    head.querySelector('.facts')?.remove();
    head.append(h('p', { class: 'river-sub' }, sub), facts(d));

    const headlineLink = d.links.find((l) => l.station_no === d.station_no) ?? null;
    const main = h(
      'div',
      { class: 'col-main' },
      statusHero(d, headlineLink),
      guideNotice(d),
      gaugesSection(d.links),
      d.station_no ? graphSection(d, headlineLink) : null,
      d.guide ? guideSection(d.guide) : null,
    );
    const side = h('div', { class: 'col-side' }, weatherSection(d), placesSection(d), nearbySection(d));
    clear(body);
    body.append(h('div', { class: 'river-grid' }, main, side));
  }

  // ---- Status hero ----
  function statusHero(d: SectionDetail, link: SectionGaugeLink | null): HTMLElement {
    const askBtn = h('button', { type: 'button', class: 'btn btn-primary ask-btn', hidden: !ctx.config()?.chat_enabled }, icon(ICONS.chat), 'Ask about this river');
    askBtn.addEventListener('click', () => ctx.openChat({ slug: d.slug, name: d.name }));
    const onConfig = () => (askBtn.hidden = !ctx.config()?.chat_enabled);
    document.addEventListener('rg:config', onConfig);
    cleanups.push(() => document.removeEventListener('rg:config', onConfig));

    let basis: string;
    if (d.status_basis === 'manual') basis = 'Paddling band set manually.';
    else if (d.status_basis === 'estimate') basis = link ? `${basisWording(link.basis, link.confidence)}.` : `${ESTIMATE_TOOLTIP}.`;
    else if (d.status_basis === 'typical') basis = 'No paddling band for this section yet. Compare the gauge with its typical range below.';
    else basis = 'No SEPA gauge is linked to this section.';

    const g = link?.gauge ?? null;
    const reading = g
      ? h(
          'p',
          { class: 'hero-reading' },
          g.level != null ? levelWithTrend(g.level, g.trend) : h('span', { class: 'lvl lvl-none' }, 'No reading'),
          h('span', { class: 'hero-gauge' }, g.trend !== 'unknown' && g.level != null ? `${TREND_LABEL[g.trend]} at ${g.name}` : `at ${g.name}`),
          h('span', { class: g.stale ? 'hero-time stale' : 'hero-time' }, g.stale ? `Stale: last reading ${relativeTime(g.level_at)}` : relativeTime(g.level_at)),
        )
      : null;

    return h(
      'section',
      { class: `status-hero st-${d.status}`, 'aria-label': 'Current status' },
      h('div', { class: 'hero-top' }, statusPill(d.status, 'lg'), h('p', { class: 'hero-basis' }, basis)),
      reading,
      h('div', { class: 'hero-actions' }, askBtn),
    );
  }

  function facts(d: SectionDetail): HTMLElement {
    const items: [string, string | null][] = [
      ['Grade', d.grade_text ? gradeLabel(d.grade_text).replace(/^Grade /, '') : null],
      ['Length', d.length_text],
      ['Time', d.time_text],
      ['Character', characterLabel(d.character)],
    ];
    return h(
      'dl',
      { class: 'facts' },
      items.filter(([, v]) => v).map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v!))),
    );
  }

  function guideNotice(d: SectionDetail): HTMLElement {
    const url = safeUrl(d.ukrgb_url);
    const updated = formatDate(d.source_updated);
    return h(
      'aside',
      { class: 'guide-notice' },
      h('p', { class: 'guide-notice-main' }, 'Hazards, access and route details: read the full, current write-up on UK Rivers Guidebook before paddling.'),
      url ? h('a', { class: 'btn btn-outline', href: url, target: '_blank', rel: 'noopener' }, 'Open on UK Rivers Guidebook', icon(ICONS.external)) : null,
      updated ? h('p', { class: 'guide-notice-date' }, `Guide entry last updated ${updated}.`) : null,
    );
  }

  // ---- Gauges ----
  function gaugesSection(links: SectionGaugeLink[]): HTMLElement {
    return h(
      'section',
      { class: 'block' },
      h('h2', null, links.length === 1 ? 'Gauge' : 'Gauges'),
      links.length ? links.map(gaugeCard) : h('p', { class: 'muted' }, 'No SEPA gauge is linked to this section. Check the guidebook for level advice.'),
    );
  }

  function gaugeCard(l: SectionGaugeLink): HTMLElement {
    const g = l.gauge;
    const band: string[] = [];
    if (l.min_level != null) band.push(`Runnable from ${formatLevel(l.min_level)}.`);
    if (l.max_level != null) band.push(`Too high above ${formatLevel(l.max_level)}.`);
    const typical =
      g.typical_low != null && g.typical_high != null
        ? `${TYPICAL_LABEL[g.typical_status]} (${formatLevel(g.typical_low)} to ${formatLevel(g.typical_high)}).`
        : `${TYPICAL_LABEL[g.typical_status]}.`;
    return h(
      'article',
      { class: 'gauge-card' },
      h('header', { class: 'gauge-head' }, h('div', null, h('h3', null, g.name), h('p', { class: 'gauge-rel' }, RELATION_LABEL[l.relation])), statusPill(l.status)),
      h(
        'p',
        { class: 'gauge-reading' },
        g.level != null ? levelWithTrend(g.level, g.trend) : h('span', { class: 'lvl lvl-none' }, 'No reading'),
        g.level != null && g.trend !== 'unknown' ? h('span', { class: 'muted' }, TREND_LABEL[g.trend]) : null,
        h('span', { class: g.stale ? 'reading-time stale' : 'reading-time' }, g.stale ? `Stale: ${relativeTime(g.level_at)}` : relativeTime(g.level_at)),
      ),
      bandBar(l),
      h('p', { class: 'band-text' }, band.length ? band.join(' ') : 'No paddling band set for this gauge.'),
      band.length ? h('p', { class: 'basis' }, basisWording(l.basis, l.confidence)) : null,
      l.reason ? h('p', { class: 'reason' }, l.reason) : null,
      h('p', { class: 'typical muted' }, typical),
    );
  }

  // ---- Graph ----
  function graphSection(d: SectionDetail, link: SectionGaugeLink | null): HTMLElement {
    const station = d.station_no!;
    const area = h('div', { class: 'graph-area' });
    let period = 'P2D';
    let graph: LevelGraph | null = null;
    let seq = 0;
    cleanups.push(() => graph?.destroy());

    const buttons = PERIODS.map(([p, label]) => {
      const b = h('button', { type: 'button', class: 'seg', 'aria-pressed': String(p === period) }, label);
      b.addEventListener('click', () => {
        period = p;
        buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(PERIODS[i][0] === p)));
        void draw();
      });
      return b;
    });

    async function draw(): Promise<void> {
      const my = ++seq;
      graph?.destroy();
      graph = null;
      area.replaceChildren(h('div', { class: 'skel skel-graph', 'aria-hidden': 'true' }));
      try {
        const [hist, mod] = await Promise.all([api.history(station, period, abort.signal), import('../graph.ts')]);
        if (destroyed || my !== seq) return;
        area.replaceChildren();
        if (!hist.points.length) {
          area.append(h('p', { class: 'muted graph-empty' }, 'No readings for this period.'));
          return;
        }
        graph = mod.levelGraph(area, hist.points, { min: link?.min_level, max: link?.max_level });
      } catch (e) {
        if (destroyed || my !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
        area.replaceChildren(errorBox("Couldn't load the level history.", () => void draw()));
      }
    }
    void draw();

    return h(
      'section',
      { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', null, 'Level history'), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, buttons)),
      h('p', { class: 'muted block-sub' }, `SEPA gauge at ${d.gauge_name ?? station}.`),
      area,
    );
  }

  // ---- Weather ----
  function weatherSection(d: SectionDetail): HTMLElement | null {
    const at = d.lat != null && d.lon != null ? { lat: d.lat, lon: d.lon } : d.put_in;
    if (!at) return null;
    const box = h('div', null, skeletonLines(2, 'skel-row'));
    const run = async () => {
      box.replaceChildren(skeletonLines(2, 'skel-row'));
      try {
        const w = await api.weather(at.lat, at.lon, abort.signal);
        if (!destroyed) box.replaceChildren(...weatherBody(w));
      } catch (e) {
        if (destroyed || (e instanceof DOMException && e.name === 'AbortError')) return;
        box.replaceChildren(errorBox("Couldn't load the forecast.", () => void run()));
      }
    };
    void run();
    return h('section', { class: 'block weather' }, h('h2', null, 'Rain and weather'), box);
  }

  function weatherBody(w: Weather): Node[] {
    const stat = (label: string, mm: number) => h('div', { class: 'rain-stat' }, h('span', { class: 'rain-num' }, mm.toFixed(1), h('small', null, ' mm')), h('span', { class: 'rain-label' }, label));
    const hours = w.hours.slice(0, 48);
    const peak = Math.max(1, ...hours.map((x) => x.rain_mm));
    const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
    const hourFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const bars = hours.map((x, i) => {
      const d = new Date(x.time);
      const midnight = d.getHours() === 0;
      return h(
        'div',
        { class: `rain-bar${midnight ? ' day-start' : ''}`, title: `${hourFmt.format(d)}: ${x.rain_mm.toFixed(1)} mm` },
        h('span', { class: 'rain-fill', style: `height:${x.rain_mm > 0 ? Math.max(4, (x.rain_mm / peak) * 100) : 0}%` }),
        i === 0 ? h('span', { class: 'rain-day' }, 'Now') : midnight && i >= 4 ? h('span', { class: 'rain-day' }, dayFmt.format(d)) : null,
      );
    });
    const out: Node[] = [h('div', { class: 'rain-stats' }, stat('Past 24 h', w.rain_past_24h_mm), stat('Next 24 h', w.rain_next_24h_mm), stat('Next 48 h', w.rain_next_48h_mm))];
    if (hours.length) {
      const wind = hours.map((x) => x.wind_kmh);
      const temp = hours.map((x) => x.temp_c);
      out.push(
        h(
          'div',
          { class: 'rain-strip-wrap' },
          h('p', { class: 'strip-label' }, 'Hourly rain, next 48 hours', h('span', { class: 'muted' }, ` (scale to ${peak.toFixed(1)} mm)`)),
          h('div', { class: 'rain-strip', role: 'img', 'aria-label': `Hourly rain over the next 48 hours, up to ${peak.toFixed(1)} mm in an hour.` }, bars),
        ),
        h(
          'p',
          { class: 'wx-line' },
          `Wind ${Math.round(Math.min(...wind))} to ${Math.round(Math.max(...wind))} km/h. Temperature ${Math.round(Math.min(...temp))} to ${Math.round(Math.max(...temp))} °C.`,
        ),
      );
    }
    out.push(h('p', { class: 'source muted' }, 'Forecast from ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'), ' for the section location.'));
    return out;
  }

  // ---- Put-in / take-out ----
  function placesSection(d: SectionDetail): HTMLElement | null {
    const put = d.put_in as Place | null;
    const take = d.take_out as Place | null;
    const centre = d.lat != null && d.lon != null ? { lat: d.lat, lon: d.lon } : null;
    if (!put && !take && !centre) return null;

    const mapEl = h('div', { class: 'mini-map', role: 'region', 'aria-label': 'Map of put-in and take-out' });
    const approx = d.location_precision === 'approx' || put?.precision === 'approx' || take?.precision === 'approx';
    const list = h(
      'ul',
      { class: 'places' },
      put ? placeItem('Put-in', put) : null,
      take ? placeItem('Take-out', take) : null,
      !put && !take && centre ? h('li', null, h('span', { class: 'place-tag' }, 'Section'), h('span', null, 'Section location only. Check the guidebook for access points.')) : null,
    );

    void import('../maplib.ts')
      .then(({ L, baseMap, cssColor }) => {
        if (destroyed) return;
        const map = baseMap(mapEl, { scrollWheelZoom: false });
        cleanups.push(() => map.remove());
        const pts: [number, number][] = [];
        const add = (p: { lat: number; lon: number }, label: string, letter: string, color: string) => {
          const m = L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: 'place-marker', html: `<span style="background:${color}">${letter}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
            title: label,
            alt: label,
          });
          m.bindPopup(h('div', null, h('strong', null, label)));
          m.addTo(map);
          pts.push([p.lat, p.lon]);
        };
        const loch = cssColor('--loch', '#1c6596');
        if (put) add(put, `Put-in: ${put.label}`, 'P', loch);
        if (take) add(take, `Take-out: ${take.label}`, 'T', cssColor('--ink', '#14232b'));
        if (!pts.length && centre) {
          L.circleMarker([centre.lat, centre.lon], { radius: 9, color: loch, weight: 2, dashArray: approx ? '3 3' : undefined, fillOpacity: 0.25 }).addTo(map);
          pts.push([centre.lat, centre.lon]);
        }
        if (pts.length === 1) map.setView(pts[0], 12);
        else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
      })
      .catch(() => mapEl.replaceChildren(h('p', { class: 'muted' }, "Couldn't load the map.")));

    return h(
      'section',
      { class: 'block' },
      h('h2', null, 'Put-in and take-out'),
      mapEl,
      list,
      h('p', { class: 'muted precision' }, approx ? 'Approximate location: positions are estimated, not from a grid reference.' : 'Positions from guidebook grid references.'),
    );
  }

  function placeItem(tag: string, p: Place): HTMLElement {
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    return h(
      'li',
      null,
      h('span', { class: 'place-tag' }, tag),
      h('span', { class: 'place-label' }, p.label || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`),
      h('a', { class: 'place-dir', href: dir, target: '_blank', rel: 'noopener' }, 'Directions'),
    );
  }

  // ---- Nearby ----
  function nearbySection(d: SectionDetail): HTMLElement | null {
    if (!d.nearby_gauges.length) return null;
    const from = d.lat != null && d.lon != null ? { lat: d.lat, lon: d.lon } : null;
    return h(
      'section',
      { class: 'block' },
      h('h2', null, 'Other gauges nearby'),
      h('ul', { class: 'nearby' }, d.nearby_gauges.map((g) => nearbyItem(g, from))),
    );
  }

  function nearbyItem(g: Gauge, from: { lat: number; lon: number } | null): HTMLElement {
    const km = from ? distanceKm(from, g) : null;
    return h(
      'li',
      { class: 'nearby-item' },
      h('div', { class: 'nearby-main' }, h('span', { class: 'nearby-name' }, g.name), h('span', { class: 'muted' }, [g.river, km != null ? `${km.toFixed(km < 10 ? 1 : 0)} km away` : null].filter(Boolean).join(', '))),
      h(
        'div',
        { class: 'nearby-side' },
        g.level != null ? levelWithTrend(g.level, g.trend) : h('span', { class: 'lvl lvl-none' }, 'No reading'),
        h('span', { class: g.stale ? 'reading-time stale' : 'reading-time' }, g.stale ? 'Stale' : TYPICAL_LABEL[g.typical_status].replace(' its', '')),
      ),
    );
  }

  // ---- Guide text ----
  function guideSection(gt: GuideText): HTMLElement | null {
    const fields: [string, string][] = [
      ['Description', gt.description],
      ['Hazards', gt.hazards],
      ['Access', gt.access],
      ['Water level', gt.water_level],
      ['Other notes', gt.other],
    ];
    const present = fields.filter(([, v]) => v && v.trim());
    if (!present.length) return null;
    return h(
      'section',
      { class: 'block guide' },
      h('h2', null, 'Guidebook notes'),
      h('p', { class: 'muted' }, 'Summarised from UK Rivers Guidebook. Always check the full, current write-up.'),
      present.map(([k, v]) => h('div', { class: 'guide-field' }, h('h3', null, k), h('p', null, v.trim()))),
    );
  }

  void load();
  return {
    destroy() {
      destroyed = true;
      abort.abort();
      for (const c of cleanups) c();
    },
  };
}
