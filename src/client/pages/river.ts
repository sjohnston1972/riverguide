// River section page.

import { distanceKm } from '../../shared/geo.ts';
import type { Gauge, GuideText, PlacePoint, SectionDetail, SectionGaugeLink, Weather } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { bandBar } from '../bandbar.ts';
import { communityPanel } from '../community.ts';
import { rainChart } from '../rainchart.ts';
import { damReleaseRow, ebbRow, SEPA_FRESHETS_URL } from '../schedule.ts';
import { errorBox, levelWithTrend, skeletonLines, statusPill, tomorrowTag } from '../components.ts';
import { gaugeBoard } from '../gaugeboard.ts';
import { clear, h, icon, safeUrl } from '../dom.ts';
import { favButton, setFavouriteName } from '../favourites.ts';
import { lastListHref } from '../filters.ts';
import type { LevelGraph } from '../graph.ts';
import { ICONS } from '../icons.ts';
import {
  basisWording,
  characterLabel,
  formatLevel,
  gradeLabel,
  RELATION_LABEL,
  relativeTime,
  TREND_LABEL,
  TYPICAL_LABEL,
  STEP_LABEL,
  STATUS_LABEL,
  OUTLOOK_WORDS,
  OUTLOOK_ARROW,
  WTW_URL,
} from '../labels.ts';
import type { AppCtx, Page } from '../main.ts';

/** The API's plain message when SEPA or Open-Meteo is down ("SEPA isn't responding just now..."). */
const upstreamMessage = (e: unknown): string | null => (e instanceof ApiError && e.code === 'upstream' ? e.message : null);

const PERIODS: [string, string][] = [
  ['P2D', '2 days'],
  ['P7D', '7 days'],
  ['P30D', '30 days'],
];

type Place = PlacePoint & { precision?: string };

/** Phones: one screen led by the gauge board, the rest on swipeable panels (styles.css, .river-phone). */
const PHONE = window.matchMedia('(max-width: 599px)');
const PANELS = [
  ['scale', 'Scale', ICONS.gauge],
  ['level', 'Level', ICONS.trend],
  ['weather', 'Weather', ICONS.rain],
  ['access', 'Access', ICONS.map],
  ['reports', 'Reports', ICONS.people],
] as const;

/** The one-screen desktop layout's media query; keep in step with styles.css (.river-dash). */
const ONE_SCREEN = window.matchMedia('(min-width: 1280px) and (min-height: 720px)');
/** Smallest scale the one-screen layout shrinks to; below it the page scrolls instead. */
const MIN_ZOOM = 0.7;

export function mountRiver(container: HTMLElement, slug: string, ctx: AppCtx): Page {
  const abort = new AbortController();
  const cleanups: (() => void)[] = [];
  let destroyed = false;

  const title = h('h1', { class: 'river-title' }, 'Loading river');
  const star = favButton(slug, '', 'fav-title');
  const head = h(
    'header',
    { class: 'river-head' },
    h('a', { class: 'back-link', href: lastListHref() }, icon(ICONS.back), 'All rivers'),
    h('div', { class: 'title-row' }, title, star),
  );
  const body = h('div', { class: 'river-body' }, skeletonLines(3, 'skel-block'));
  const article = h('article', { class: 'wrap river-page' }, head, body);
  container.append(article);
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

  let shown: SectionDetail | null = null;
  function render(d: SectionDetail): void {
    shown = d;
    ctx.setTitle(d.name);
    title.textContent = d.name;
    setFavouriteName(star, d.name);
    const region = [d.river !== d.name ? d.river : null, d.region].filter(Boolean).join(', ');
    // On phones the status band's details move up here, next to the name.
    const sub = PHONE.matches ? [region, ...sectionDetails(d).map(([k, v]) => (k === 'Grade' ? `Grade ${v}` : v))].join(' · ') : region;
    head.querySelector('.river-sub')?.remove();
    head.querySelector('.river-source')?.remove();
    head.append(
      h('p', { class: 'river-sub' }, sub),
      // Sections added from Where's the Water: their grade, length and access come from it.
      d.source === 'wtw' ? h('p', { class: 'river-source muted' }, 'Section details from ', wtwLink(), '.') : '',
    );

    const reports = api.reports(slug);
    reports.catch(() => undefined);
    let now = nowCard(d);
    // A report or vote can recalibrate the band at once: refresh this page's status, and the river list next time it's shown.
    const onChange = () => {
      api.sections.invalidate();
      void api
        .section(slug, true)
        .then((fresh) => {
          if (destroyed) return;
          const next = nowCard(fresh);
          now.card.replaceWith(next.card);
          if (now.graph && next.graph) now.graph.replaceWith(next.graph);
          now = next;
        })
        .catch(() => undefined);
    };
    const community = communityPanel({ slug, gaugeName: d.gauge_name, siteKey: ctx.config()?.turnstile_site_key ?? null, data: reports, onChange });
    if (PHONE.matches) {
      renderPhone(d, now, community);
      return;
    }
    // Three groups: the river now (status card and level history); reports, releases and notes; weather,
    // access and nearby gauges. Phones stack them, tablets use two columns, wide desktops fit the page
    // on one screen with the last two groups as tiles (styles.css, .river-dash).
    const colNow = h('div', { class: 'col-now' }, now.card, now.graph);
    const releases = releasesSection(d);
    const guide = d.guide ? guideSection(d.guide) : null;
    const weather = weatherSection(d);
    const places = placesSection(d);
    const nearby = nearbySection(d);
    const colMid = h('div', { class: 'col-mid' }, releases, community, guide);
    const side = h('div', { class: 'col-side' }, weather, places, nearby);
    // One screen: the dam releases list sits under the level history (the left column has the room);
    // the other tiles fill two columns in this order, an odd last tile spanning both.
    const placeTiles = () => {
      const oneScreen = ONE_SCREEN.matches;
      if (releases) {
        if (oneScreen) colNow.append(releases);
        else colMid.prepend(releases);
      }
      const tiles = [weather, places, nearby, community, oneScreen ? null : releases, guide].filter((t): t is HTMLElement => t != null);
      for (const t of [weather, places, nearby, community, releases, guide]) t?.classList.remove('tile-wide');
      tiles.forEach((t, i) => (t.style.order = String(i)));
      if (tiles.length % 2) tiles[tiles.length - 1].classList.add('tile-wide');
    };
    placeTiles();
    ONE_SCREEN.addEventListener('change', placeTiles);
    cleanups.push(() => ONE_SCREEN.removeEventListener('change', placeTiles));
    clear(body);
    body.append(h('div', { class: 'river-grid' }, colNow, h('div', { class: 'col-tiles' }, colMid, side)));
    // Content arrives in stages; fit again as it does (shrinking only, so nothing jumps back and forth).
    scheduleFit(true);
    void reports.then(() => scheduleFit(false), () => undefined);
  }

  // ---- Now card: section status and linked gauges (as tabs); the level history is its own card ----
  function nowCard(d: SectionDetail): { card: HTMLElement; graph: HTMLElement | null } {
    const askBtn = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-sm ask-btn', hidden: !ctx.config()?.chat_enabled, 'aria-label': 'Ask about this river' },
      icon(ICONS.chat),
      h('span', { class: 'ask-long' }, 'Ask about this river'),
      h('span', { class: 'ask-short', 'aria-hidden': 'true' }, 'Ask'),
    );
    askBtn.addEventListener('click', () => ctx.openChat({ slug: d.slug, name: d.name }));
    const onConfig = () => (askBtn.hidden = !ctx.config()?.chat_enabled);
    document.addEventListener('rg:config', onConfig);
    cleanups.push(() => document.removeEventListener('rg:config', onConfig));

    // Headline gauge first, then the rest in ranked order.
    const headline = d.links.find((l) => l.station_no === d.station_no) ?? null;
    const links = headline ? [headline, ...d.links.filter((l) => l !== headline)] : d.links;

    const step = headline?.step ?? null;
    let basis: string | Node | null = null;
    if (d.status_basis === 'paddler') basis = h('span', null, 'Paddler levels from ', wtwLink(), '.', graphLink(headline?.calibration_url ?? null));
    else if (d.status_basis === 'manual') basis = 'Paddling band set manually.';
    else if (d.status_basis === 'community') basis = headline?.reason ?? 'Paddling band set from community reports.';
    else if (d.status_basis === 'estimate') basis = h('span', null, 'These levels are an estimate. ', calibrationLink(), '.');
    else if (d.status_basis === 'typical') basis = h('span', null, 'No paddling band for this section yet. ', calibrationLink(), '.');
    else if (d.status_basis === 'none') basis = 'No SEPA gauge is linked to this section.';

    const top = h(
      'div',
      { class: `status-hero st-${d.status}`, 'aria-label': 'Current status' },
      h(
        'div',
        { class: 'hero-top' },
        h('div', { class: 'hero-pills' }, statusPill(d.status), step ? h('span', { class: `step-tag s-${step}` }, STEP_LABEL[step]) : null, tomorrowTag(d)),
        basis ? h('p', { class: 'hero-basis' }, basis) : null,
        d.release_today ? h('p', { class: 'release-today' }, 'Scheduled release today.') : null,
      ),
      h('div', { class: 'hero-actions' }, askBtn),
      detailsStrip(d),
    );
    const card = h('section', { class: 'now-card' }, top);
    if (!links.length) {
      card.append(h('div', { class: 'now-body' }, h('p', { class: 'muted' }, 'No SEPA gauge is linked to this section. Check the guidebook for level advice.')));
      return { card, graph: null };
    }

    const multi = links.length > 1;
    const panel = h('div', { class: 'gauge-panel', id: `gauge-panel-${d.slug}`, role: multi ? 'tabpanel' : null });
    const graphArea = h('div', { class: 'graph-area' });
    let selected = 0;
    let period = 'P2D';
    let graph: LevelGraph | null = null;
    let seq = 0;
    cleanups.push(() => graph?.destroy());

    const tabs = links.map((l, i) => {
      const t = h(
        'button',
        { type: 'button', role: 'tab', class: 'gauge-tab', id: `gauge-tab-${l.station_no}`, 'aria-controls': panel.id, 'aria-selected': String(i === 0), tabindex: i === 0 ? '0' : '-1' },
        h('span', { class: 'gauge-tab-name' }, l.gauge.name),
        h('span', { class: 'gauge-tab-meta' }, statusPill(l.status), l.gauge.level != null ? h('span', null, formatLevel(l.gauge.level)) : null),
      );
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (selected + step + links.length) % links.length;
        select(next);
        tabs[next].focus();
      });
      return t;
    });

    const periodBtns = PERIODS.map(([p, label]) => {
      const b = h('button', { type: 'button', class: 'seg', 'aria-pressed': String(p === period) }, label);
      b.addEventListener('click', () => {
        period = p;
        periodBtns.forEach((x, i) => x.setAttribute('aria-pressed', String(PERIODS[i][0] === p)));
        void draw();
      });
      return b;
    });

    function select(i: number): void {
      selected = i;
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === i));
        t.tabIndex = j === i ? 0 : -1;
      });
      if (multi) panel.setAttribute('aria-labelledby', tabs[i].id);
      renderPanel();
      void draw();
    }

    function renderPanel(): void {
      panel.replaceChildren(...gaugeDetail(links[selected], d.status_basis === 'paddler' ? d.station_no : null));
    }

    async function draw(): Promise<void> {
      const my = ++seq;
      const link = links[selected];
      graph?.destroy();
      graph = null;
      graphArea.replaceChildren(h('div', { class: 'skel skel-graph', 'aria-hidden': 'true' }));
      try {
        const [hist, mod] = await Promise.all([api.history(link.station_no, period, abort.signal), import('../graph.ts')]);
        if (destroyed || my !== seq) return;
        graphArea.replaceChildren();
        graphArea.removeAttribute('role');
        graphArea.removeAttribute('aria-label');
        if (!hist.points.length) {
          graphArea.append(h('p', { class: 'muted graph-empty' }, 'No readings for this period.'));
          return;
        }
        graph = mod.levelGraph(graphArea, hist.points, { min: link.min_level, max: link.max_level, fill: ONE_SCREEN.matches });
        scheduleFit(false);
        const vs = hist.points.map((p) => p.v);
        graphArea.setAttribute('role', 'img');
        graphArea.setAttribute(
          'aria-label',
          `Level at ${link.gauge.name}, last ${PERIODS.find(([p]) => p === period)?.[1] ?? period}: now ${formatLevel(vs[vs.length - 1])}, ` +
            `lowest ${formatLevel(Math.min(...vs))}, highest ${formatLevel(Math.max(...vs))}.`,
        );
      } catch (e) {
        if (destroyed || my !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
        graphArea.replaceChildren(errorBox(upstreamMessage(e) ?? "Couldn't load the level history.", () => void draw()));
      }
    }

    card.append(h('div', { class: 'now-body' }, multi ? h('div', { class: 'gauge-tabs', role: 'tablist', 'aria-label': 'Linked SEPA gauges' }, tabs) : null, panel));
    // Follows the selected gauge tab.
    const graphCard = h(
      'section',
      { class: 'now-graph' },
      h('div', { class: 'now-graph-head' }, h('h2', null, 'Level history'), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, periodBtns)),
      graphArea,
    );
    // Entering or leaving the one-screen layout changes how the graph is sized.
    const onLayout = () => void draw();
    ONE_SCREEN.addEventListener('change', onLayout);
    cleanups.push(() => ONE_SCREEN.removeEventListener('change', onLayout));
    select(0);
    return { card, graph: graphCard };
  }

  // ---- Phones: one screen, the gauge board first, everything else on panels you swipe to ----
  function renderPhone(d: SectionDetail, now: { card: HTMLElement; graph: HTMLElement | null }, community: HTMLElement): void {
    const headline = d.links.find((l) => l.station_no === d.station_no) ?? null;
    const g = headline?.gauge ?? null;
    const t = g && !g.stale ? (g.outlook?.tomorrow ?? null) : null;
    const tomorrowWord = d.status_tomorrow && d.status_tomorrow !== 'unknown' && d.status_tomorrow !== d.status
      ? STATUS_LABEL[d.status_tomorrow]
      : d.step_tomorrow && d.step_tomorrow !== d.step ? STEP_LABEL[d.step_tomorrow] : null;
    const reading = g
      ? h(
          'div',
          { class: 'phone-reading' },
          g.level != null ? levelWithTrend(g.level, g.trend, g.stale) : h('span', { class: 'lvl lvl-none' }, 'No reading'),
          h('span', { class: 'phone-reading-at' }, g.trend !== 'unknown' && g.level != null ? `${TREND_LABEL[g.trend]} at ${g.name}` : `at ${g.name}`),
          h('span', { class: g.stale ? 'hero-time stale' : 'hero-time' }, g.stale ? `Stale: last reading ${relativeTime(g.level_at)}` : relativeTime(g.level_at)),
          t ? h('span', { class: 'phone-reading-next' }, `Tomorrow about ${formatLevel(t.level)}${tomorrowWord ? `, ${tomorrowWord}` : ''}`) : null,
        )
      : null;
    const board = headline ? gaugeBoard(headline) : null;
    const scaleBody = board
      ? [reading, board]
      : [reading, h('p', { class: 'muted' }, d.links.length ? 'No paddling band or typical range for this gauge yet.' : 'No SEPA gauge is linked to this section. Check the guidebook for level advice.')];

    // The site credits close the last panel (the footer is hidden on this layout).
    const footerText = document.querySelector('.site-footer .wrap')?.cloneNode(true) as HTMLElement | undefined;
    if (footerText) footerText.className = 'panel-credits';

    const content: Record<(typeof PANELS)[number][0], Array<Node | null>> = {
      scale: scaleBody,
      level: [now.card, now.graph, releasesSection(d)],
      weather: [weatherSection(d) ?? h('p', { class: 'muted' }, 'No location for a forecast.')],
      access: [placesSection(d), nearbySection(d), d.guide ? guideSection(d.guide) : null],
      reports: [community, footerText ?? null],
    };
    const panels = PANELS.map(([key, label], i) =>
      h('section', { class: `panel panel-${key}`, id: `panel-${key}`, role: 'tabpanel', 'aria-label': label, 'aria-labelledby': `tab-${key}`, tabindex: i === 0 ? '0' : '-1' }, content[key]),
    );
    const swipe = h('div', { class: 'swipe' }, panels);
    const tabs = PANELS.map(([key, label, svgIcon], i) =>
      h('button', { type: 'button', role: 'tab', class: 'panel-tab', id: `tab-${key}`, 'aria-controls': `panel-${key}`, 'aria-selected': String(i === 0) }, icon(svgIcon), h('span', null, label)),
    );
    const go = (i: number, smooth = true) => swipe.scrollTo({ left: i * swipe.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    const mark = (i: number) => {
      tabs.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
      panels.forEach((p, j) => (p.tabIndex = j === i ? 0 : -1));
    };
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => go(i));
      b.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (i + step + tabs.length) % tabs.length;
        go(next);
        tabs[next].focus();
      });
    });
    let frame = 0;
    swipe.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mark(Math.round(swipe.scrollLeft / Math.max(1, swipe.clientWidth))));
    }, { passive: true });

    const pills = h('div', { class: 'hero-pills phone-pills' }, statusPill(d.status), d.step ? h('span', { class: `step-tag s-${d.step}` }, STEP_LABEL[d.step]) : null, tomorrowTag(d));
    clear(body);
    body.append(pills, swipe, h('nav', { class: 'panel-tabs', role: 'tablist', 'aria-label': 'River details' }, tabs));
  }

  /** One linked gauge: reading, band bar and compact facts. */
  /** `citedGauge`: the gauge whose Where's the Water levels the status header already cites. */
  function gaugeDetail(l: SectionGaugeLink, citedGauge: string | null = null): Node[] {
    const g = l.gauge;
    let band = 'None set for this gauge';
    if (l.levels && l.basis === 'paddler')
      band = `Runnable ${formatLevel(l.levels.scrape)} to ${formatLevel(l.levels.huge)} (scrapeable to huge)`;
    else if (l.min_level != null && l.max_level != null) band = `Runnable ${formatLevel(l.min_level)} to ${formatLevel(l.max_level)}`;
    else if (l.min_level != null) band = `Runnable from ${formatLevel(l.min_level)}`;
    else if (l.max_level != null) band = `Too high above ${formatLevel(l.max_level)}`;
    const typical =
      g.typical_low != null && g.typical_high != null
        ? `${TYPICAL_LABEL[g.typical_status]} (${formatLevel(g.typical_low)} to ${formatLevel(g.typical_high)})`
        : TYPICAL_LABEL[g.typical_status];
    const rows: [string, string][] = [['Gauge', `${g.name}, ${RELATION_LABEL[l.relation]}`], ['Paddling band', band]];
    const estimate = l.basis === 'guide' || l.basis === 'duration' || l.basis === 'typical-relative';
    if ((l.min_level != null || l.max_level != null) && l.basis !== 'paddler') rows.push(['Basis', estimate ? 'Estimate' : basisWording(l.basis, l.confidence)]);
    if (g.days_reached_pct != null) rows.push(['How often', `This level is reached on ${daysText(g.days_reached_pct)} of days`]);
    rows.push(['Typical range', typical]);

    const out: Node[] = [
      h(
        'p',
        { class: 'hero-reading' },
        g.level != null ? levelWithTrend(g.level, g.trend) : h('span', { class: 'lvl lvl-none' }, 'No reading'),
        h('span', { class: 'hero-gauge' }, g.trend !== 'unknown' && g.level != null ? `${TREND_LABEL[g.trend]} at ${g.name}` : `at ${g.name}`),
        h('span', { class: g.stale ? 'hero-time stale' : 'hero-time' }, g.stale ? `Stale: last reading ${relativeTime(g.level_at)}` : relativeTime(g.level_at)),
      ),
    ];
    const ol = outlookLine(l);
    if (ol) out.push(ol);
    const bar = bandBar(l);
    if (bar) {
      // On phones the headline gauge's scale is the gauge board on the first panel.
      if (l.station_no === shown?.station_no) bar.classList.add('is-headline');
      out.push(bar);
    }
    out.push(h('dl', { class: 'gauge-facts' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
    if (l.basis === 'paddler') {
      // The header already cites the headline gauge's levels; only other gauges need their own line.
      if (l.levels && l.station_no === citedGauge) return out;
      out.push(
        h(
          'p',
          { class: 'reason' },
          l.levels ? 'Paddler levels from ' : 'Gauge chosen by ',
          wtwLink(),
          l.levels ? '.' : '; no paddler levels set for it yet.',
          graphLink(l.calibration_url),
        ),
      );
    } else if (!estimate && l.reason) out.push(h('p', { class: 'reason' }, l.reason));
    return out;
  }

  /** Where this gauge is heading: a predicted level and range (model) or just a direction (trend). */
  function outlookLine(l: SectionGaugeLink): HTMLElement | null {
    const o = l.gauge.outlook;
    if (!o) return null;
    const rain = o.rain_today_mm + o.rain_tomorrow_mm;
    const rainText = rain < 1 ? 'little rain due today or tomorrow' : `${rain < 10 ? rain.toFixed(1) : Math.round(rain)} mm of rain due today and tomorrow`;
    const head = h('strong', null, `${OUTLOOK_WORDS[o.direction]}.`);
    if (o.basis === 'model' && o.tomorrow) {
      const toLabel = l.step_tomorrow ? `${STEP_LABEL[l.step_tomorrow]} on the paddler scale` : l.status_tomorrow && l.status_tomorrow !== 'unknown' ? STATUS_LABEL[l.status_tomorrow].toLowerCase() : null;
      const same = l.step_tomorrow ? l.step_tomorrow === l.step : l.status_tomorrow === l.status;
      const to = toLabel ? (same ? `still ${toLabel}` : `which would make it ${toLabel}`) : null;
      return h(
        'p',
        { class: `outlook outlook-${o.direction}` },
        h('span', { class: 'outlook-arrow', 'aria-hidden': 'true' }, OUTLOOK_ARROW[o.direction]),
        h(
          'span',
          null,
          head,
          ` Tomorrow's peak about ${formatLevel(o.tomorrow.level)} (likely ${formatLevel(o.tomorrow.lo)} to ${formatLevel(o.tomorrow.hi)})${to ? `, ${to}` : ''}`,
          o.day_after ? `; the day after about ${formatLevel(o.day_after.level)}` : '',
          `. ${rainText[0].toUpperCase()}${rainText.slice(1)}. `,
          h('span', { class: 'outlook-note' }, 'Rough estimate from how this gauge has responded to similar rain before.'),
        ),
      );
    }
    return h(
      'p',
      { class: `outlook outlook-${o.direction}` },
      h('span', { class: 'outlook-arrow', 'aria-hidden': 'true' }, OUTLOOK_ARROW[o.direction]),
      h('span', null, head, ` From the current trend, with ${rainText}. `, h('span', { class: 'outlook-note' }, 'No level prediction for this gauge.')),
    );
  }

  /** Jumps to the community panel and opens its report form. */
  function calibrationLink(): HTMLElement {
    const a = h('a', { href: '#report' }, 'Please help provide calibration data');
    a.addEventListener('click', (e) => {
      const panel = document.getElementById('report');
      if (!panel) return;
      e.preventDefault();
      panel.dispatchEvent(new CustomEvent('rg:open-report'));
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.focus({ preventScroll: true });
    });
    return a;
  }

  /** " See the calibration graph." linking to Where's the Water's rivermap.org graph for this gauge. */
  function graphLink(url: string | null): (string | HTMLElement)[] {
    const href = safeUrl(url);
    return href ? [' See the ', h('a', { href, target: '_blank', rel: 'noopener' }, 'calibration graph'), '.'] : [];
  }

  function wtwLink(): HTMLElement {
    return h('a', { href: WTW_URL, target: '_blank', rel: 'noopener' }, "Where's the Water");
  }

  // ---- Scheduled releases (dam releases and tidal windows) ----
  function releasesSection(d: SectionDetail): HTMLElement | null {
    if (d.dam_schedule) {
      const sch = d.dam_schedule;
      return h(
        'section',
        { class: 'block releases' },
        h('div', { class: 'block-head' }, h('h2', null, 'Scheduled releases'), h('a', { href: '/releases' }, 'All dam releases')),
        sch.releases.length
          ? h('ul', { class: 'sched-list' }, sch.releases.slice(0, 5).map((r) => damReleaseRow(r)))
          : h('p', { class: 'muted' }, 'No more releases are scheduled this season.'),
        h(
          'p',
          { class: 'muted' },
          sch.note ?? `Released from ${sch.dam}.`,
          sch.includes_compensation ? ' Size is the average flow, including the compensation flow.' : ' Size is the average flow the release adds to the river.',
        ),
        h(
          'p',
          { class: 'source muted' },
          'Release schedule: SSE freshet schedule, published by ',
          h('a', { href: SEPA_FRESHETS_URL, target: '_blank', rel: 'noopener' }, 'SEPA'),
          '. Times are approximate and releases can be cancelled: check before travelling.',
        ),
      );
    }
    if (d.tide_ebbs) {
      const ebbs = d.tide_ebbs.filter((e) => e.daylight).slice(0, 5);
      return h(
        'section',
        { class: 'block releases' },
        h('div', { class: 'block-head' }, h('h2', null, 'Tides'), h('a', { href: '/falls-of-lora' }, 'Full tide outlook')),
        ebbs.length
          ? h('ul', { class: 'sched-list' }, ebbs.map((e) => ebbRow(e)))
          : h('p', { class: 'muted' }, 'No working daylight ebbs in the next two weeks.'),
        h('p', { class: 'source muted' }, 'Working ebbs need an Oban tidal range over 3.2 m. Predicted from SEPA’s Oban tide gauge; weather can shift the tide by up to half a metre.'),
      );
    }
    if (!d.releases.length) return null;
    const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    return h(
      'section',
      { class: 'block releases' },
      h('h2', null, 'Scheduled releases'),
      h(
        'ul',
        { class: 'release-days' },
        d.releases.map((day) => h('li', { class: day === today ? 'is-today' : null }, day === today ? 'Today' : fmt.format(new Date(`${day}T12:00:00Z`)))),
      ),
      d.release_note ? h('p', { class: 'muted' }, d.release_note) : null,
      h('p', { class: 'source muted' }, 'Release dates from ', wtwLink(), '. Check with the operator before travelling; releases can be cancelled.'),
    );
  }

  function daysText(pct: number): string {
    if (pct >= 99) return 'over 99%';
    if (pct <= 0.5) return 'under 1%';
    return `${pct < 10 ? pct.toFixed(1).replace(/\.0$/, '') : Math.round(pct)}%`;
  }

  /** Grade, length and character, whichever the section has. */
  function sectionDetails(d: SectionDetail): [string, string][] {
    // Consistent spacing: "1(2)" -> "1 (2)", like "3/4 (5)".
    const grade = d.grade_text ? gradeLabel(d.grade_text).replace(/^Grade\s*/i, '').replace(/\s*\(/g, ' (').trim() : '';
    const items: [string, string | null][] = [
      ['Grade', grade || null],
      ['Length', d.length_text],
      ['Character', characterLabel(d.character)],
    ];
    return items.filter((i): i is [string, string] => !!i[1]);
  }

  /** Grade, length and character along the bottom edge of the status band. */
  function detailsStrip(d: SectionDetail): HTMLElement | null {
    const present = sectionDetails(d);
    if (!present.length) return null;
    return h(
      'dl',
      { class: 'hero-details' },
      present.map(([k, v]) => h('div', { class: 'hero-detail' }, h('dt', null, k), h('dd', null, v!))),
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
        scheduleFit(false);
      } catch (e) {
        if (destroyed || (e instanceof DOMException && e.name === 'AbortError')) return;
        box.replaceChildren(errorBox(upstreamMessage(e) ?? "Couldn't load the forecast.", () => void run()));
      }
    };
    void run();
    return h('section', { class: 'block weather' }, h('h2', null, 'Rain and weather'), box);
  }

  function weatherBody(w: Weather): Node[] {
    const stat = (label: string, mm: number) => h('div', { class: 'rain-stat' }, h('span', { class: 'rain-num' }, mm.toFixed(1), h('small', null, ' mm')), h('span', { class: 'rain-label' }, label));
    const hours = w.hours.slice(0, 48);
    const out: Node[] = [h('div', { class: 'rain-stats' }, stat('Past 24 h', w.rain_past_24h_mm), stat('Next 24 h', w.rain_next_24h_mm), stat('Next 48 h', w.rain_next_48h_mm))];
    if (hours.length) {
      const wind = hours.map((x) => x.wind_kmh);
      const temp = hours.map((x) => x.temp_c);
      out.push(
        h('div', { class: 'rain-strip-wrap' }, h('p', { class: 'strip-label' }, 'Rain, next 48 hours'), rainChart(hours)),
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

    // Leaflet (~50 kB) and the tiles load only when the map is about to scroll into view: on a phone it sits
    // below the level graph the reader came for.
    const loadMap = () =>
      import('../maplib.ts')
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
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          void loadMap();
        },
        { rootMargin: '300px' },
      );
      io.observe(mapEl);
      cleanups.push(() => io.disconnect());
    } else void loadMap();

    return h(
      'section',
      { class: 'block places-block' },
      h('h2', null, 'Put-in and take-out'),
      mapEl,
      list,
      h('p', { class: 'muted precision' }, approx ? 'Approximate location: positions are estimated from place names.' : 'Exact positions.'),
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
      { class: 'block nearby-block' },
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
      h('p', { class: 'muted' }, 'Summarised from guidebook information. Always check a current guidebook.'),
      present.map(([k, v]) => h('div', { class: 'guide-field' }, h('h3', null, k), h('p', null, v.trim()))),
    );
  }

  // Wide desktops: the whole page on one screen (styles.css). Only while this page is mounted.
  document.documentElement.classList.add('river-dash', 'river-phone');
  // Crossing the phone breakpoint (rotating, resizing) swaps between the swipe and column layouts.
  const onPhoneChange = () => {
    if (shown && !destroyed) render(shown);
  };
  PHONE.addEventListener('change', onPhoneChange);
  cleanups.push(() => PHONE.removeEventListener('change', onPhoneChange));
  // If the layout still doesn't fit the window (a short laptop screen), scale the page down until it
  // does rather than hiding anything. The two list tiles (reports, dam releases) scroll in place instead.
  let zoom = 1;
  const overflowing = () => {
    const de = document.documentElement;
    if (de.scrollHeight > de.clientHeight + 1) return true;
    const boxes = [...article.querySelectorAll<HTMLElement>('.col-now, .col-mid > :not(.community, .releases), .col-side > *')];
    return boxes.some((b) => b.scrollHeight > b.clientHeight + 1);
  };
  const fit = (fromFull: boolean) => {
    if (destroyed) return;
    if (!ONE_SCREEN.matches) {
      article.style.zoom = '';
      zoom = 1;
      return;
    }
    if (fromFull) zoom = 1;
    for (;;) {
      article.style.zoom = zoom === 1 ? '' : String(zoom);
      if (zoom <= MIN_ZOOM || !overflowing()) break;
      zoom = Math.max(MIN_ZOOM, Math.round((zoom - 0.03) * 100) / 100);
    }
  };
  let fitTimer = 0;
  const scheduleFit = (fromFull: boolean) => {
    window.clearTimeout(fitTimer);
    fitTimer = window.setTimeout(() => fit(fromFull), 120);
  };
  const onResize = () => scheduleFit(true);
  window.addEventListener('resize', onResize);
  ONE_SCREEN.addEventListener('change', onResize);
  cleanups.push(() => {
    window.clearTimeout(fitTimer);
    window.removeEventListener('resize', onResize);
    ONE_SCREEN.removeEventListener('change', onResize);
  });
  void load();
  return {
    destroy() {
      destroyed = true;
      abort.abort();
      document.documentElement.classList.remove('river-dash', 'river-phone');
      for (const c of cleanups) c();
    },
  };
}
