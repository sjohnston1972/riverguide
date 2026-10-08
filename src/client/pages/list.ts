// Home page: rivers list with filters, and the same filters on a map (/map).

import type { SectionSummary } from '../../shared/types.ts';
import { api } from '../api.ts';
import { errorBox, estimateMark, levelWithTrend, skeletonLines, statusPill, tomorrowTag, unknownReason } from '../components.ts';
import { clear, h, icon } from '../dom.ts';
import {
  activeFilterCount,
  applyFilters,
  DEFAULT_FILTERS,
  type Filters,
  filtersFromQuery,
  filtersToQuery,
  REGIONS,
  setLastListHref,
  type SortKey,
  type StatusFilter,
} from '../filters.ts';
import { FAVOURITES_EVENT, favButton, favourites } from '../favourites.ts';
import { ICONS } from '../icons.ts';
import { clockTime, gradeLabel, STEP_LABEL } from '../labels.ts';
import type { AppCtx, Page } from '../main.ts';
import type { SectionsMap } from '../mapview.ts';
import { replaceUrl, type Route } from '../router.ts';

type View = 'list' | 'map';
const REFRESH_MS = 5 * 60_000;

export function mountList(container: HTMLElement, route: Route, ctx: AppCtx): Page {
  let filters: Filters = filtersFromQuery(route.search);
  let view: View = route.name === 'map' ? 'map' : 'list';
  let sections: SectionSummary[] | null = null;
  let loadError: string | null = null;
  /** A background refresh failed: the list still shows the last levels, and says so. */
  let refreshFailed = false;
  /** Row elements by section, reused while filtering; new data (new objects) or a favourites change rebuilds them. */
  let rows = new WeakMap<SectionSummary, HTMLLIElement>();
  const rowFor = (s: SectionSummary) => {
    let li = rows.get(s);
    if (!li) rows.set(s, (li = row(s)));
    return li;
  };
  let map: SectionsMap | null = null;
  let mapLoading: Promise<void> | null = null;
  let destroyed = false;

  // ---- Controls ----
  const headline = h('h1', { class: 'headline' }, 'Checking river levels');
  const sub = h('p', { class: 'headline-sub' }, 'Live SEPA gauge readings for whitewater sections across Scotland.');

  const search = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Search rivers or sections',
    'aria-label': 'Search rivers or sections',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  let searchTimer: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      filters = { ...filters, q: search.value };
      changed();
    }, 120);
  });

  const runningNow = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, h('span', { class: 'chip-dot', 'aria-hidden': 'true' }), 'Running now');
  runningNow.addEventListener('click', () => {
    filters = { ...filters, status: filters.status === 'runnable' ? 'any' : 'runnable' };
    changed();
  });

  const favChip = h('button', { type: 'button', class: 'chip fav-chip', 'aria-pressed': 'false', title: 'Favourites' }, icon(ICONS.star), h('span', { class: 'fav-chip-label' }, 'Favourites'));
  favChip.addEventListener('click', () => {
    filters = { ...filters, fav: !filters.fav };
    changed();
  });

  const riseChip = h('button', { type: 'button', class: 'chip rise-chip', 'aria-pressed': 'false' }, h('span', { class: 'rise-arrow', 'aria-hidden': 'true' }, '↑'), 'On the rise');
  riseChip.addEventListener('click', () => {
    filters = { ...filters, rise: !filters.rise };
    changed();
  });

  const filterToggle = h('button', { type: 'button', class: 'chip chip-ghost filter-toggle', 'aria-expanded': 'false', 'aria-controls': 'filter-panel' }, icon(ICONS.sliders), h('span', { class: 'filter-toggle-text' }, 'Filters'));

  const select = (label: string, options: [string, string][], onChange: (v: string) => void) => {
    const sel = h('select', { class: 'select' }, options.map(([v, t]) => h('option', { value: v }, t)));
    sel.addEventListener('change', () => onChange(sel.value));
    return { sel, field: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), sel) };
  };
  const gradeOpts: [string, string][] = [1, 2, 3, 4, 5, 6].map((g) => [String(g), String(g)]);

  const region = select('Region', [['', 'All regions'], ...REGIONS.map((r): [string, string] => [r, r])], (v) => {
    filters = { ...filters, region: v };
    changed();
  });
  const gmin = select('Grade from', gradeOpts, (v) => {
    const n = Number(v);
    filters = { ...filters, gmin: n, gmax: Math.max(n, filters.gmax) };
    changed();
  });
  const gmax = select('Grade to', gradeOpts, (v) => {
    const n = Number(v);
    filters = { ...filters, gmax: n, gmin: Math.min(n, filters.gmin) };
    changed();
  });
  const status = select(
    'Status',
    [
      ['any', 'Any status'],
      ['runnable', 'Runnable'],
      ['low', 'Low'],
      ['high', 'High'],
      ['unknown', 'Unknown'],
    ],
    (v) => {
      filters = { ...filters, status: v as StatusFilter };
      changed();
    },
  );
  const sort = select(
    'Sort',
    [
      ['status', 'Runnable first'],
      ['name', 'Name A to Z'],
    ],
    (v) => {
      filters = { ...filters, sort: v as SortKey };
      changed();
    },
  );
  const clearBtn = h('button', { type: 'button', class: 'btn btn-quiet clear-filters' }, 'Clear filters');
  clearBtn.addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS, sort: filters.sort };
    changed();
  });

  const panel = h(
    'div',
    { class: 'filter-panel', id: 'filter-panel' },
    region.field,
    h('div', { class: 'field-pair' }, gmin.field, gmax.field),
    status.field,
    sort.field,
    clearBtn,
  );
  filterToggle.addEventListener('click', () => {
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    filterToggle.setAttribute('aria-expanded', String(open));
  });

  const listLink = h('a', { class: 'seg', href: '/' }, icon(ICONS.list), 'List');
  const mapLink = h('a', { class: 'seg', href: '/map' }, icon(ICONS.map), 'Map');
  const resultCount = h('p', { class: 'result-count', 'aria-live': 'polite' });

  const listBody = h('div', { class: 'list-body' });
  const mapBody = h('div', { class: 'map-body', hidden: true });
  const mapEl = h('div', { class: 'map-canvas', role: 'region', 'aria-label': 'Map of river sections' });
  mapBody.append(mapEl);

  container.append(
    h(
      'div',
      { class: 'wrap list-page' },
      h('section', { class: 'overview' }, headline, sub),
      h(
        'div',
        { class: 'list-layout' },
        h(
          'aside',
          { class: 'filters', 'aria-label': 'Search and filters' },
          h('div', { class: 'search-wrap' }, icon(ICONS.search, 'icon search-icon'), search),
          h('div', { class: 'quick-row' }, runningNow, riseChip, favChip, filterToggle),
          panel,
        ),
        h('section', { class: 'results', 'aria-label': 'River sections' }, h('div', { class: 'results-bar' }, resultCount, h('nav', { class: 'segmented', 'aria-label': 'View' }, listLink, mapLink)), listBody, mapBody),
      ),
    ),
  );

  // ---- Rendering ----
  function syncControls(): void {
    if (document.activeElement !== search) search.value = filters.q;
    region.sel.value = filters.region;
    gmin.sel.value = String(filters.gmin);
    gmax.sel.value = String(filters.gmax);
    status.sel.value = filters.status;
    sort.sel.value = filters.sort;
    runningNow.setAttribute('aria-pressed', String(filters.status === 'runnable'));
    favChip.setAttribute('aria-pressed', String(filters.fav));
    riseChip.setAttribute('aria-pressed', String(filters.rise));
    const n = activeFilterCount(filters);
    filterToggle.querySelector('.filter-toggle-text')!.textContent = n ? `Filters (${n})` : 'Filters';
    clearBtn.hidden = n === 0 && !filters.q;
    const qs = filtersToQuery(filters);
    setLastListHref(`${view === 'map' ? '/map' : '/'}${qs}`);
    listLink.href = `/${qs}`;
    mapLink.href = `/map${qs}`;
    if (view === 'list') listLink.setAttribute('aria-current', 'page');
    else listLink.removeAttribute('aria-current');
    if (view === 'map') mapLink.setAttribute('aria-current', 'page');
    else mapLink.removeAttribute('aria-current');
  }

  function changed(): void {
    replaceUrl(`${view === 'map' ? '/map' : '/'}${filtersToQuery(filters)}`);
    syncControls();
    renderResults();
  }

  function renderResults(): void {
    listBody.hidden = view !== 'list';
    mapBody.hidden = view !== 'map';
    ctx.setTitle(view === 'map' ? 'Map' : null);

    if (loadError) {
      headline.textContent = 'River levels unavailable';
      sub.textContent = 'The list will appear once the levels load.';
      resultCount.textContent = '';
      clear(listBody);
      listBody.hidden = false;
      mapBody.hidden = true;
      listBody.append(errorBox(`Couldn't load river levels. ${loadError}`, () => load(true)));
      return;
    }
    if (!sections) {
      clear(listBody);
      listBody.append(skeletonLines(8));
      return;
    }

    const { base, shown } = applyFilters(sections, filters, favourites());
    const runnable = base.filter((s) => s.status === 'runnable').length;
    headline.textContent = `${runnable} ${runnable === 1 ? 'section' : 'sections'} estimated runnable`;
    const narrowed = base.length !== sections.length;
    // How old the levels are, from the newest current reading (not the poll schedule).
    const newest = sections.reduce<string | null>((m, s) => (s.level_at && !s.stale && (!m || s.level_at > m) ? s.level_at : m), null);
    const levels = refreshFailed
      ? `Couldn't refresh${newest ? `; showing levels from ${clockTime(newest)}` : ''}.`
      : newest
        ? `SEPA levels as of ${clockTime(newest)}.`
        : 'Levels from SEPA gauges.';
    sub.textContent = sections.length
      ? narrowed
        ? `Out of ${base.length} matching your search and filters. ${levels}`
        : `Out of ${sections.length} sections across Scotland. ${levels}`
      : 'No river sections are loaded yet.';
    sub.classList.toggle('headline-sub-warn', refreshFailed);
    resultCount.textContent = shown.length === sections.length ? `${shown.length} sections` : `Showing ${shown.length} of ${sections.length} sections`;

    if (view === 'list') renderList(shown);
    else void renderMap(shown);
  }

  function renderList(shown: SectionSummary[]): void {
    clear(listBody);
    if (!shown.length && filters.fav && !favourites().size) {
      listBody.append(
        h(
          'div',
          { class: 'empty' },
          h('p', null, 'No favourites yet. Tap the star on a river to add it here. Favourites are saved on this device.'),
          h('button', { type: 'button', class: 'btn', onclick: () => { filters = { ...filters, fav: false }; changed(); } }, 'Show all rivers'),
        ),
      );
      return;
    }
    if (!shown.length) {
      listBody.append(
        h(
          'div',
          { class: 'empty' },
          h(
            'p',
            null,
            !sections!.length
              ? 'No river sections yet. Check back soon.'
              : filters.rise && activeFilterCount(filters) === 0 && !filters.q && !filters.fav
                ? 'No rivers are rising or expected to rise right now.'
                : 'No sections match these filters.',
          ),
          sections!.length ? h('button', { type: 'button', class: 'btn', onclick: () => { filters = { ...DEFAULT_FILTERS }; changed(); } }, 'Clear search and filters') : null,
        ),
      );
      return;
    }
    listBody.append(h('ul', { class: 'river-list' }, shown.map(rowFor)));
  }

  async function renderMap(shown: SectionSummary[]): Promise<void> {
    if (!map) {
      if (!mapLoading) {
        mapEl.replaceChildren(h('p', { class: 'muted map-loading' }, 'Loading map'));
        mapLoading = import('../mapview.ts')
          .then((m) => {
            if (destroyed) return;
            mapEl.replaceChildren();
            map = m.createSectionsMap(mapEl);
          })
          .catch(() => {
            mapEl.replaceChildren(errorBox("Couldn't load the map.", () => { mapLoading = null; void renderMap(shown); }));
          });
      }
      await mapLoading;
      const loaded = map as SectionsMap | null; // reassigned in the promise above
      if (!loaded || destroyed || view !== 'map') return;
      // Filters may have changed while loading.
      loaded.setSections(applyFilters(sections ?? [], filters, favourites()).shown);
      return;
    }
    map.show();
    map.setSections(shown);
  }

  async function load(force = false, quiet = false): Promise<void> {
    loadError = null;
    if (force && !quiet) {
      sections = null;
      renderResults();
    }
    try {
      const data = await api.sections(force);
      if (destroyed) return;
      sections = data;
      refreshFailed = false;
    } catch (e) {
      if (destroyed) return;
      if (!sections) loadError = e instanceof Error ? e.message : 'Network error.';
      else refreshFailed = true;
    }
    renderResults();
  }

  syncControls();
  renderResults();
  void load();
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void load(true, true);
  }, REFRESH_MS);
  // Starring in the list (or another tab) changes what the favourites filter shows.
  const onFavourites = () => {
    rows = new WeakMap(); // stars on reused rows would be out of date
    if (filters.fav) renderResults();
  };
  document.addEventListener(FAVOURITES_EVENT, onFavourites);

  return {
    update(r: Route) {
      if (r.name !== 'list' && r.name !== 'map') return false;
      filters = filtersFromQuery(r.search);
      view = r.name === 'map' ? 'map' : 'list';
      syncControls();
      renderResults();
      return true;
    },
    destroy() {
      destroyed = true;
      window.clearInterval(timer);
      document.removeEventListener(FAVOURITES_EVENT, onFavourites);
      window.clearTimeout(searchTimer);
      map?.destroy();
    },
  };
}

function row(s: SectionSummary): HTMLLIElement {
  return h(
    'li',
    { class: 'river-item' },
    h(
      'a',
      { class: `river-row st-${s.status}`, href: `/river/${encodeURIComponent(s.slug)}` },
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-name' }, s.name),
        h('span', { class: 'row-meta' }, s.river && s.river !== s.name ? h('span', null, s.river) : null, h('span', null, gradeLabel(s.grade_text)), h('span', { class: 'row-region' }, s.region)),
      ),
      h(
        'span',
        { class: 'row-side' },
        h('span', { class: 'row-status' }, statusPill(s.status),
          s.step ? h('span', { class: `step-tag s-${s.step}` }, STEP_LABEL[s.step]) : (estimateMark(s.status_basis, s.status_confidence) ?? unknownReason(s)),
          s.release_today ? h('span', { class: 'release-tag' }, s.slug === 'falls-of-lora-tidal-rapid' ? 'Ebb today' : 'Release today') : null,
          tomorrowTag(s),
        ),
        s.level != null ? levelWithTrend(s.level, s.trend, s.stale) : h('span', { class: 'lvl lvl-none' }, s.station_no ? 'No reading' : 'No gauge'),
      ),
    ),
    favButton(s.slug, s.name, 'fav-row'),
  );
}

