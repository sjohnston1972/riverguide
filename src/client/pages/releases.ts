// Dam releases: every hydro release in SEPA's freshet schedule, by river, next one first.

import type { ReleasesOverview } from '../../shared/types.ts';
import { api } from '../api.ts';
import { errorBox, skeletonLines } from '../components.ts';
import { clear, h } from '../dom.ts';
import { gradeLabel } from '../labels.ts';
import type { AppCtx, Page } from '../main.ts';
import { damReleaseRow, SEPA_FRESHETS_URL } from '../schedule.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const LATER_SHOWN = 5;

export function mountReleases(container: HTMLElement, ctx: AppCtx): Page {
  ctx.setTitle('Dam releases');
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
      .then((d) => !destroyed && render(d))
      .catch((e: Error) => {
        if (destroyed) return;
        clear(body);
        body.append(errorBox(`Couldn’t load the release schedule. ${e.message}`, load));
      });
  };

  function render(d: ReleasesOverview): void {
    clear(body);
    const upcoming = d.dams.filter((x) => x.releases.length);
    const finished = d.dams.filter((x) => !x.releases.length);
    if (!upcoming.length) body.append(h('p', { class: 'notice' }, 'No more releases are scheduled this season. Next year’s releases will appear here once SEPA publishes the new schedule.'));
    body.append(
      h(
        'div',
        { class: 'sched-grid' },
        upcoming.map((dam) => {
          const [next, ...later] = dam.releases;
          return h(
            'section',
            { class: 'sched-card', 'aria-label': dam.river },
            h('div', { class: 'sched-card-head' }, h('h2', null, dam.river), h('span', { class: 'muted' }, dam.dam)),
            h('p', { class: 'sched-label' }, 'Next release'),
            h('ul', { class: 'sched-list sched-next' }, damReleaseRow(next)),
            later.length ? h('p', { class: 'sched-label' }, 'Later') : null,
            later.length ? h('ul', { class: 'sched-list' }, later.slice(0, LATER_SHOWN).map((r) => damReleaseRow(r))) : null,
            later.length > LATER_SHOWN ? h('p', { class: 'muted sched-more' }, `and ${later.length - LATER_SHOWN} more this season`) : null,
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
        }),
      ),
      finished.length
        ? h('p', { class: 'muted sched-finished' }, `No more releases this season: ${finished.map((x) => x.river).join(', ')}.`)
        : '',
    );
  }

  load();
  return {
    destroy: () => {
      destroyed = true;
    },
  };
}
