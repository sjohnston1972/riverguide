// "Paddled it recently?" panel: community level reports for a section, with a quick
// report form and "same for me / not for me" votes.

import { BAND_RULES, VERDICT_LABEL, VERDICTS } from '../shared/community.ts';
import type { CommunityReport, CommunityReports, Verdict } from '../shared/types.ts';
import { ApiError, api } from './api.ts';
import { h } from './dom.ts';
import { formatLevel, relativeTime } from './labels.ts';
import { TurnstileWidget } from './turnstile.ts';

const SHOW_FIRST = 4;

const SLOTS: [label: string, hour: number][] = [
  ['Morning', 9],
  ['Late morning', 11],
  ['Midday', 13],
  ['Afternoon', 15],
  ['Evening', 18],
];

export interface CommunityPanelOptions {
  slug: string;
  /** Headline gauge name, for "your level will be recorded from …". */
  gaugeName: string | null;
  siteKey: string | null;
  data: Promise<CommunityReports>;
  /** Called after a change that can move the community band (report added/deleted, vote). */
  onChange: () => void;
}

function dayOptions(now = new Date()): { label: string; date: Date }[] {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    return { label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmt.format(d), date: d };
  });
}

export function communityPanel(o: CommunityPanelOptions): HTMLElement {
  const root = h('section', { class: 'community', 'aria-label': 'Community level reports' });
  const tsBox = h('div', { class: 'community-check' });
  let widget: TurnstileWidget | null = null;
  let state: CommunityReports | null = null;
  let expanded = false;

  /** Make sure this device has passed the one-off bot check. */
  async function ensureVerified(): Promise<void> {
    if (state?.verified) return;
    let token: string | null = null;
    if (o.siteKey) {
      widget ??= new TurnstileWidget(tsBox, o.siteKey);
      token = await widget.token();
    }
    await api.verifyDevice(token);
    if (state) state.verified = true;
  }

  async function withVerify<T>(fn: () => Promise<T>): Promise<T> {
    await ensureVerified();
    try {
      return await fn();
    } catch (e) {
      // Cookie lost or expired: verify once more and retry.
      if (e instanceof ApiError && e.code === 'verify') {
        if (state) state.verified = false;
        await ensureVerified();
        return fn();
      }
      throw e;
    }
  }

  async function refresh(): Promise<void> {
    state = await api.reports(o.slug);
    render();
  }

  function progressText(s: CommunityReports): string {
    if (s.band) return `Paddling band set from ${s.band.reports} reports by ${s.band.people} people.`;
    const { reports, people, days } = s.progress;
    if (!reports) return `Tell others how it was. With ${BAND_RULES.reports} reports from ${BAND_RULES.people} people on ${BAND_RULES.days} different days, the community sets this river's levels.`;
    const left: string[] = [];
    if (reports < BAND_RULES.reports) left.push(`${BAND_RULES.reports - reports} more report${BAND_RULES.reports - reports === 1 ? '' : 's'}`);
    if (people < BAND_RULES.people) left.push(`${BAND_RULES.people - people} more ${BAND_RULES.people - people === 1 ? 'person' : 'people'}`);
    if (days < BAND_RULES.days) left.push('another day');
    return `${reports} report${reports === 1 ? '' : 's'} so far. Community levels need ${left.join(', ')}.`;
  }

  // ---- Report form ----
  function form(): HTMLElement {
    let verdict: Verdict | null = null;
    const msg = h('p', { class: 'form-msg', role: 'status' });
    const days = dayOptions();
    const daySel = h('select', { class: 'field', 'aria-label': 'Day' }, days.map((d, i) => h('option', { value: String(i) }, d.label)));
    const slotSel = h('select', { class: 'field', 'aria-label': 'Time of day' }, SLOTS.map(([label, hour]) => h('option', { value: String(hour) }, label)));
    const note = h('textarea', { class: 'field', rows: 2, maxlength: 280, placeholder: 'Optional: anything useful, e.g. "first drop needs portaging at this level"' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Add report');

    const syncSlots = () => {
      const now = new Date();
      const isToday = daySel.value === '0';
      let lastOk = 0;
      [...slotSel.options].forEach((opt, i) => {
        opt.disabled = isToday && Number(opt.value) > now.getHours() + 1;
        if (!opt.disabled) lastOk = i;
      });
      if (slotSel.selectedOptions[0]?.disabled || isToday) slotSel.selectedIndex = lastOk;
    };
    daySel.addEventListener('change', syncSlots);
    syncSlots();

    const verdictBtns = VERDICTS.map((v) => {
      const b = h('button', { type: 'button', class: `verdict v-btn-${v}`, 'aria-pressed': 'false' }, h('span', { class: `vdot v-${v}` }), VERDICT_LABEL[v]);
      b.addEventListener('click', () => {
        verdict = v;
        verdictBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        submit.disabled = false;
      });
      return b;
    });

    const f = h(
      'form',
      { class: 'report-form' },
      h('fieldset', null, h('legend', null, 'How was it?'), h('div', { class: 'verdicts' }, verdictBtns)),
      h('fieldset', null, h('legend', null, 'When did you paddle?'), h('div', { class: 'when' }, daySel, slotSel)),
      h('label', { class: 'note-label' }, 'Note', note),
      tsBox,
      h('div', { class: 'form-actions' }, submit, h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => ((expanded = false), render()) }, 'Cancel')),
      msg,
      h(
        'p',
        { class: 'fine-print' },
        o.gaugeName ? `The level at ${o.gaugeName} at that time is recorded automatically. ` : '',
        'Reports are public and anonymous. Keep notes to river conditions.',
      ),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const chosen = verdict;
      if (!chosen) return;
      const d = days[Number(daySel.value)].date;
      const when = new Date(d);
      when.setHours(Number(slotSel.value), 0, 0, 0);
      const paddledAt = new Date(Math.min(when.getTime(), Date.now()));
      submit.disabled = true;
      msg.textContent = 'Saving…';
      withVerify(() => api.submitReport(o.slug, { verdict: chosen, paddled_at: paddledAt.toISOString(), note: note.value || undefined }))
        .then(({ report }) => {
          expanded = false;
          msg.textContent = '';
          return refresh().then(() => {
            flash(report.level != null ? `Thanks! Recorded as ${VERDICT_LABEL[report.verdict].toLowerCase()} at ${formatLevel(report.level)}.` : 'Thanks! Report added.');
            o.onChange();
          });
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          msg.textContent = err instanceof Error ? err.message : "Couldn't save your report.";
        });
    });
    return f;
  }

  let flashMsg = '';
  function flash(text: string): void {
    flashMsg = text;
    render();
    setTimeout(() => {
      flashMsg = '';
      render();
    }, 6000);
  }

  // ---- Report list ----
  function voteButton(r: CommunityReport, vote: 1 | -1): HTMLElement {
    const pressed = r.my_vote === vote;
    const count = vote === 1 ? r.agrees : r.disagrees;
    const label = vote === 1 ? 'Same for me' : 'Not for me';
    const b = h(
      'button',
      { type: 'button', class: 'vote', 'aria-pressed': String(pressed), disabled: r.mine, title: r.mine ? 'Your report' : label },
      vote === 1 ? '👍' : '👎',
      h('span', { class: 'vote-label' }, label),
      count ? h('span', { class: 'vote-count' }, String(count)) : null,
    );
    b.addEventListener('click', () => {
      b.disabled = true;
      withVerify(() => api.vote(r.id, pressed ? 0 : vote))
        .then(() => refresh())
        .then(() => o.onChange())
        .catch((err: unknown) => {
          b.disabled = false;
          flash(err instanceof Error ? err.message : "Couldn't record your vote.");
        });
    });
    return b;
  }

  function reportItem(r: CommunityReport): HTMLElement {
    const when = new Date(r.paddled_at);
    const dateText = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(when);
    const extra = r.mine
      ? h(
          'button',
          {
            type: 'button',
            class: 'link-btn',
            onclick: () =>
              void api
                .deleteReport(r.id)
                .then(() => refresh())
                .then(() => o.onChange())
                .catch(() => flash("Couldn't delete that report.")),
          },
          'Delete',
        )
      : r.note
        ? h(
            'button',
            {
              type: 'button',
              class: 'link-btn',
              title: 'Report this note as inappropriate',
              onclick: (e: Event) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                void withVerify(() => api.flag(r.id))
                  .then(() => (btn.textContent = 'Reported'))
                  .catch(() => (btn.disabled = false));
              },
            },
            'Report note',
          )
        : null;
    return h(
      'li',
      { class: 'report' },
      h(
        'div',
        { class: 'report-top' },
        h('span', { class: `verdict-tag v-tag-${r.verdict}` }, h('span', { class: `vdot v-${r.verdict}` }), VERDICT_LABEL[r.verdict]),
        h('span', { class: 'report-level' }, r.level != null ? `${formatLevel(r.level)}${r.gauge_name ? ` at ${r.gauge_name}` : ''}` : 'No gauge reading'),
        h('span', { class: 'report-when muted', title: `Added ${relativeTime(r.created_at)}` }, dateText),
      ),
      r.note ? h('p', { class: 'report-note' }, r.note) : null,
      h('div', { class: 'report-actions' }, voteButton(r, 1), voteButton(r, -1), extra),
    );
  }

  let showAll = false;
  function render(): void {
    if (!state) return;
    const s = state;
    const head = h('div', { class: 'community-head' }, h('h2', null, 'Paddled it recently?'), h('p', { class: 'muted' }, progressText(s)));
    const list = s.reports.length
      ? h(
          'ul',
          { class: 'reports' },
          (showAll ? s.reports : s.reports.slice(0, SHOW_FIRST)).map(reportItem),
        )
      : null;
    const more =
      s.reports.length > SHOW_FIRST
        ? h('button', { type: 'button', class: 'link-btn', onclick: () => ((showAll = !showAll), render()) }, showAll ? 'Show fewer' : `Show all ${s.reports.length} reports`)
        : null;
    const cta = s.enabled
      ? expanded
        ? form()
        : h('button', { type: 'button', class: 'btn btn-outline', onclick: () => ((expanded = true), render()) }, 'Report how it was')
      : h('p', { class: 'muted' }, 'Community reports are paused at the moment.');
    root.replaceChildren(head, flashMsg ? h('p', { class: 'notice notice-ok', role: 'status' }, flashMsg) : '', cta, list ?? '', more ?? '', expanded ? '' : tsBox);
  }

  root.append(h('div', { class: 'community-head' }, h('h2', null, 'Paddled it recently?'), h('p', { class: 'muted loading' }, 'Loading community reports…')));
  o.data
    .then((d) => {
      state = d;
      render();
    })
    .catch(() => root.replaceChildren(h('div', { class: 'community-head' }, h('h2', null, 'Paddled it recently?'), h('p', { class: 'muted' }, "Couldn't load community reports."))));
  return root;
}
