// Falls of Lora: the tidal rapid at Connel, predicted from SEPA's Oban tide gauge.

import type { LoraEbb, LoraOverview } from '../../shared/types.ts';
import { api } from '../api.ts';
import { errorBox, skeletonLines } from '../components.ts';
import { clear, h } from '../dom.ts';
import type { AppCtx, Page } from '../main.ts';
import { ebbDayKey, ebbRow, ebbTimeline, FALLS_INFO_URL } from '../schedule.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const LORA_SLUG = 'falls-of-lora-tidal-rapid';

export function mountLora(container: HTMLElement, ctx: AppCtx): Page {
  ctx.setTitle('Falls of Lora');
  const body = h('div', { class: 'sched-body' }, skeletonLines(6));
  container.append(
    h(
      'div',
      { class: 'wrap sched-page' },
      h('h1', null, 'Falls of Lora'),
      h(
        'p',
        { class: 'sched-lede' },
        'The tidal rapid under Connel Bridge runs on the ebb, as Loch Etive empties into the sea. It works on big tides: an Oban tidal range over 3.2 m, and big over 3.5 m. ',
        h('a', { href: `/river/${LORA_SLUG}` }, 'Section details'),
        '.',
      ),
      body,
      h(
        'p',
        { class: 'source muted' },
        'Tides are predicted by River Guide from SEPA’s Oban tide gauge, with ranges scaled to match published tide tables. Ebb timings follow ',
        ext(FALLS_INFO_URL, 'fallsoflora.info'),
        ': the ebb starts about 2 h 10 min after high water at Oban, the main wave forms about two hours later, and the flow reverses about 2 h 50 min after low water. Low pressure or strong south-westerly winds can raise the tide by up to half a metre and spoil the wave. Predicted times are usually within 10 minutes, and within 30 minutes nine times in ten. Not for navigation.',
      ),
    ),
  );

  let destroyed = false;
  let showDark = false;
  let data: LoraOverview | null = null;

  const load = () => {
    api
      .lora()
      .then((d) => {
        if (destroyed) return;
        data = d;
        render();
      })
      .catch((e: Error) => {
        if (destroyed) return;
        clear(body);
        body.append(errorBox(`Couldn’t load the tide predictions. ${e.message}`, load));
      });
  };

  function render(): void {
    if (!data) return;
    clear(body);
    const daylight = data.ebbs.filter((e) => e.daylight);
    const next = daylight[0] ?? null;
    if (next) body.append(nextCard(next));
    else body.append(h('p', { class: 'notice' }, 'No working daylight ebbs in the next two months.'));

    const list = (showDark ? data.ebbs : daylight).filter((e) => e !== next);
    const dark = data.ebbs.length - daylight.length;
    const toggle = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(showDark) }, showDark ? 'Hide after-dark ebbs' : `Show after-dark ebbs (${dark})`);
    toggle.addEventListener('click', () => {
      showDark = !showDark;
      render();
    });
    body.append(
      h(
        'section',
        { class: 'sched-card' },
        h('div', { class: 'sched-card-head' }, h('h2', null, 'Next two months'), dark ? toggle : null),
        list.length ? h('ul', { class: 'sched-list' }, groupByMonth(list)) : h('p', { class: 'muted' }, 'Nothing else in the next two months.'),
      ),
    );
  }

  function nextCard(e: LoraEbb): HTMLElement {
    return h(
      'section',
      { class: 'sched-card sched-hero', 'aria-label': 'Next working ebb' },
      h('p', { class: 'sched-label' }, 'Next daylight ebb'),
      h('ul', { class: 'sched-list sched-next' }, ebbRow(e)),
      ebbTimeline(e),
    );
  }

  load();
  return {
    destroy: () => {
      destroyed = true;
    },
  };
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Europe/London' });

/** Rows with a month heading whenever the month changes. */
function groupByMonth(ebbs: LoraEbb[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  let month = '';
  for (const e of ebbs) {
    const m = ebbDayKey(e).slice(0, 7);
    if (m !== month) {
      month = m;
      out.push(h('li', { class: 'sched-month', 'aria-hidden': 'true' }, monthFmt.format(new Date(e.main_wave))));
    }
    out.push(ebbRow(e));
  }
  return out;
}
