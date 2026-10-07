// Dam releases: every hydro release in SEPA's freshet schedule, by river, next one first.
// A river filter (?river=garry) narrows the page to one river's full season.

import type { ReleasesOverview } from '../../shared/types.ts';
import { api } from '../api.ts';
import { errorBox, skeletonLines } from '../components.ts';
import { clear, h } from '../dom.ts';
import { gradeLabel } from '../labels.ts';
import type { AppCtx, Page } from '../main.ts';
import { replaceUrl, type Route } from '../router.ts';
import { damReleaseRow, SEPA_FRESHETS_URL } from '../schedule.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const LATER_SHOWN = 5;

type Dam = ReleasesOverview['dams'][number];

export function mountReleases(container: HTMLElement, route: Route, ctx: AppCtx): Page {
  ctx.setTitle('Dam releases');
  let river = new URLSearchParams(route.search).get('river');
  let data: ReleasesOverview | null = null;

  const filterBar = h('div', { class: 'filter-bar', role: 'group', 'aria-label': 'Filter by river' });
  const body = h('div', { class: 'sched-body' }, skeletonLines(6));
  container.append(
    h(
      'div',
      { class: 'wrap sched-page' },
      h('h1', null, 'Dam releases'),
      h(
        'p',
        { class: 'sched-lede' },
        'Scheduled hydro releases (freshets) on Scottish rivers, from SSE’s freshet schedule as published by SEPA. Size is the average flow the release adds to the river.',
      ),
      filterBar,
      body,
      h(
        'p',
        { class: 'source muted' },
        'Release schedule: SSE freshet schedule, published by ',
        ext(SEPA_FRESHETS_URL, 'SEPA'),
        '. Times are local and approximate, and releases can change or be cancelled: check before travelling. Except where noted, the size is on top of the river’s normal compensation flow.',
      ),
    ),
  );

  let destroyed = false;
  const load = () => {
    api
      .releases()
      .then((d) => {
        if (destroyed) return;
        data = d;
        render();
      })
      .catch((e: Error) => {
        if (destroyed) return;
        clear(body);
        body.append(errorBox(`Couldn’t load the release schedule. ${e.message}`, load));
      });
  };

  function choose(key: string | null): void {
    river = key;
    replaceUrl(key ? `/releases?river=${encodeURIComponent(key)}` : '/releases');
    render();
  }

  function renderFilter(upcoming: Dam[]): void {
    const chip = (key: string | null, label: string, count: number) => {
      const b = h(
        'button',
        { type: 'button', class: 'filter-chip', 'aria-pressed': String(river === key) },
        label,
        h('span', { class: 'filter-count' }, String(count)),
      );
      b.addEventListener('click', () => choose(river === key ? null : key));
      return b;
    };
    const total = upcoming.reduce((n, d) => n + d.releases.length, 0);
    const byName = [...upcoming].sort((a, b) => a.river.localeCompare(b.river));
    filterBar.replaceChildren(chip(null, 'All rivers', total), ...byName.map((d) => chip(d.key, d.river.replace(/^River /, ''), d.releases.length)));
  }

  function render(): void {
    if (!data) return;
    clear(body);
    const upcoming = data.dams.filter((x) => x.releases.length);
    const finished = data.dams.filter((x) => !x.releases.length);
    // A river with nothing left this season (or an old link) falls back to all rivers.
    if (river && !upcoming.some((d) => d.key === river)) river = null;
    renderFilter(upcoming);
    filterBar.hidden = upcoming.length < 2;

    if (!upcoming.length) {
      body.append(h('p', { class: 'notice' }, 'No more releases are scheduled this season. Next year’s releases will appear here once SEPA publishes the new schedule.'));
      return;
    }
    const shown = river ? upcoming.filter((d) => d.key === river) : upcoming;
    body.append(
      h('div', { class: `sched-grid${river ? ' is-single' : ''}` }, shown.map((dam) => damCard(dam, !!river))),
      !river && finished.length ? h('p', { class: 'muted sched-finished' }, `No more releases this season: ${finished.map((x) => x.river).join(', ')}.`) : '',
    );
  }

  load();
  return {
    update(next) {
      if (next.name !== 'releases') return false;
      choose(new URLSearchParams(next.search).get('river'));
      return true;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

/** One river's card: next release, then later ones (all of them when the page is filtered to this river). */
function damCard(dam: Dam, full: boolean): HTMLElement {
  const [next, ...later] = dam.releases;
  const shownLater = full ? later : later.slice(0, LATER_SHOWN);
  return h(
    'section',
    { class: 'sched-card', 'aria-label': dam.river },
    h('div', { class: 'sched-card-head' }, h('h2', null, dam.river), h('span', { class: 'muted' }, dam.dam)),
    h('p', { class: 'sched-label' }, 'Next release'),
    h('ul', { class: 'sched-list sched-next' }, damReleaseRow(next)),
    later.length ? h('p', { class: 'sched-label' }, full ? `Rest of the season (${later.length})` : 'Later') : null,
    later.length ? h('ul', { class: 'sched-list' }, shownLater.map((r) => damReleaseRow(r))) : null,
    later.length > shownLater.length
      ? h('p', { class: 'sched-more' }, h('a', { href: `/releases?river=${encodeURIComponent(dam.key)}` }, `See all ${later.length + 1} releases this season`))
      : null,
    dam.includes_compensation ? h('p', { class: 'muted sched-note' }, 'Size includes the compensation flow.') : null,
    dam.sections.length
      ? h(
          'p',
          { class: 'sched-sections' },
          'Runs through ',
          dam.sections.flatMap((s, i) => [
            i ? (i === dam.sections.length - 1 ? ' and ' : ', ') : '',
            h('a', { href: `/river/${encodeURIComponent(s.slug)}` }, s.name),
            h('span', { class: 'muted' }, ` (${gradeLabel(s.grade_text).replace(/^Grade\s*/i, 'grade ')})`),
          ]),
        )
      : null,
  );
}
