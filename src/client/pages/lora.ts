// Falls of Lora: the tidal rapid at Connel, predicted from SEPA's Oban tide gauge.
// A date filter narrows the list: quick ranges (?when=weekends) or one day (?date=2026-10-18).

import type { LoraEbb, LoraOverview } from '../../shared/types.ts';
import { api } from '../api.ts';
import { errorBox, skeletonLines } from '../components.ts';
import { clear, h } from '../dom.ts';
import type { AppCtx, Page } from '../main.ts';
import { replaceUrl, type Route } from '../router.ts';
import { ebbDayKey, ebbRow, ebbTimeline, FALLS_INFO_URL } from '../schedule.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const LORA_SLUG = 'falls-of-lora-tidal-rapid';
const DAY = 86_400_000;

type When = 'all' | 'week' | 'weekends' | 'month' | 'next-month';
const WHEN_LABEL: Record<When, string> = { all: 'Any time', week: 'Next 7 days', weekends: 'Weekends', month: 'This month', 'next-month': 'Next month' };

const ukKey = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(t));
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Europe/London' });

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Whether an ebb (by its UK date, YYYY-MM-DD) falls in a quick range. */
function inRange(when: When, day: string, today: string): boolean {
  switch (when) {
    case 'all':
      return true;
    case 'week':
      return day < ukKey(Date.parse(`${today}T12:00:00Z`) + 7 * DAY);
    case 'weekends': {
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      return dow === 0 || dow === 6;
    }
    case 'month':
      return day.slice(0, 7) === today.slice(0, 7);
    case 'next-month':
      return day.slice(0, 7) === addMonths(today, 1);
  }
}

export function mountLora(container: HTMLElement, route: Route, ctx: AppCtx): Page {
  ctx.setTitle('Falls of Lora');
  let when: When = 'all';
  let date: string | null = null;
  let showDark = false;
  let data: LoraOverview | null = null;
  readQuery(route.search);

  function readQuery(search: string): void {
    const q = new URLSearchParams(search);
    const d = q.get('date');
    const w = q.get('when') as When | null;
    date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    when = !date && w && w in WHEN_LABEL ? w : 'all';
  }

  const filterBar = h('div', { class: 'filter-bar', role: 'group', 'aria-label': 'Filter by date' });
  const dateInput = h('input', { type: 'date', class: 'date-input', 'aria-label': 'Pick a date' });
  dateInput.addEventListener('change', () => setFilter('all', dateInput.value || null));

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
      filterBar,
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

  function setFilter(w: When, d: string | null): void {
    when = w;
    date = d;
    replaceUrl(date ? `/falls-of-lora?date=${date}` : when !== 'all' ? `/falls-of-lora?when=${when}` : '/falls-of-lora');
    render();
  }

  function renderFilter(today: string, last: string): void {
    const chips = (Object.keys(WHEN_LABEL) as When[]).map((w) => {
      const b = h('button', { type: 'button', class: 'filter-chip', 'aria-pressed': String(!date && when === w) }, WHEN_LABEL[w]);
      b.addEventListener('click', () => setFilter(w, null));
      return b;
    });
    dateInput.min = today;
    dateInput.max = last;
    dateInput.value = date ?? '';
    const picker = h('label', { class: `date-field${date ? ' is-set' : ''}` }, h('span', { class: 'date-field-label' }, 'On'), dateInput);
    filterBar.replaceChildren(...chips, picker);
  }

  function render(): void {
    if (!data) return;
    clear(body);
    const today = ukKey(Date.now());
    const last = data.ebbs.length ? ebbDayKey(data.ebbs[data.ebbs.length - 1]) : today;
    renderFilter(today, last);

    if (date) {
      body.append(dayView(data.ebbs, date));
      return;
    }

    const daylight = data.ebbs.filter((e) => e.daylight);
    const next = when === 'all' ? (daylight[0] ?? null) : null;
    if (when === 'all') {
      if (next) body.append(nextCard(next, 'Next daylight ebb'));
      else body.append(h('p', { class: 'notice' }, 'No working daylight ebbs in the next two months.'));
    }

    const pool = (showDark ? data.ebbs : daylight).filter((e) => e !== next && inRange(when, ebbDayKey(e), today));
    const darkInRange = data.ebbs.filter((e) => !e.daylight && inRange(when, ebbDayKey(e), today)).length;
    const toggle = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(showDark) }, showDark ? 'Hide after-dark ebbs' : `Show after-dark ebbs (${darkInRange})`);
    toggle.addEventListener('click', () => {
      showDark = !showDark;
      render();
    });
    const title = when === 'all' ? 'Next two months' : when === 'month' ? `This month (${monthFmt.format(new Date())})` : when === 'next-month' ? `Next month (${monthFmt.format(new Date(Date.parse(`${addMonths(today, 1)}-15T12:00:00Z`)))})` : WHEN_LABEL[when];
    body.append(
      h(
        'section',
        { class: 'sched-card' },
        h('div', { class: 'sched-card-head' }, h('h2', null, title), darkInRange ? toggle : null),
        pool.length ? h('ul', { class: 'sched-list' }, groupByMonth(pool)) : h('p', { class: 'muted' }, 'No working ebbs in this range.'),
        when === 'next-month' && last < `${addMonths(today, 1)}-28`
          ? h('p', { class: 'muted sched-note' }, `Predictions run two months ahead, to ${longDay.format(new Date(`${last}T12:00:00Z`))}.`)
          : null,
      ),
    );
  }

  /** One day: each working ebb with its full timeline, or the nearest ones either side. */
  function dayView(ebbs: LoraEbb[], day: string): HTMLElement {
    const label = longDay.format(new Date(`${day}T12:00:00Z`));
    const onDay = ebbs.filter((e) => ebbDayKey(e) === day);
    if (onDay.length) {
      return h(
        'div',
        { class: 'sched-body' },
        onDay.map((e) => nextCard(e, `${label}${e.daylight ? '' : ', after dark'}`)),
      );
    }
    const before = [...ebbs].reverse().find((e) => e.daylight && ebbDayKey(e) < day);
    const after = ebbs.find((e) => e.daylight && ebbDayKey(e) > day);
    return h(
      'section',
      { class: 'sched-card' },
      h('div', { class: 'sched-card-head' }, h('h2', null, label)),
      h('p', null, 'The tide isn’t big enough for the Falls to work on this day.'),
      before || after ? h('p', { class: 'sched-label' }, 'Nearest daylight ebbs') : null,
      before || after ? h('ul', { class: 'sched-list' }, [before, after].filter((e): e is LoraEbb => !!e).map((e) => ebbRow(e))) : null,
    );
  }

  function nextCard(e: LoraEbb, label: string): HTMLElement {
    return h(
      'section',
      { class: 'sched-card sched-hero', 'aria-label': label },
      h('p', { class: 'sched-label' }, label),
      h('ul', { class: 'sched-list sched-next' }, ebbRow(e)),
      ebbTimeline(e),
    );
  }

  load();
  return {
    update(next) {
      if (next.name !== 'lora') return false;
      readQuery(next.search);
      render();
      return true;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

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
