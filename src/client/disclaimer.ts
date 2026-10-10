// The terms of use: shown as a dialog on a first visit, and stays until the visitor ticks that they
// accept them. Acceptance is remembered in this browser; change TERMS_VERSION when the wording
// changes in substance, to ask everyone again. The About page shows the same text.

import { h } from './dom.ts';

const KEY = 'rg-terms';
const TERMS_VERSION = '2026-10-10';

/** In memory too, for browsers that block storage: accepted for this visit at least. */
let acceptedThisVisit = false;

function accepted(): boolean {
  if (acceptedThisVisit) return true;
  try {
    return localStorage.getItem(KEY) === TERMS_VERSION;
  } catch {
    return false;
  }
}

function remember(): void {
  acceptedThisVisit = true;
  try {
    localStorage.setItem(KEY, TERMS_VERSION);
  } catch {
    /* storage blocked: asked again next visit */
  }
}

/** The terms, as paragraphs and a list. */
export function termsContent(): HTMLElement[] {
  return [
    h('p', null, 'River Guide helps you decide which Scottish rivers might be worth a look. It is a planning aid, not a safety service.'),
    h(
      'ul',
      null,
      h('li', null, 'River levels, statuses and forecasts come from automated data and estimates. They can be wrong, out of date or missing.'),
      h('li', null, 'Paddling bands, grades and descriptions are a guide only. Rivers change, and hazards such as trees, landslips and works are not shown.'),
      h('li', null, 'Reports from other paddlers are anonymous and unchecked.'),
      h('li', null, 'Whitewater paddling is dangerous. Always inspect the river, check a current guidebook and local knowledge, and paddle within your ability.'),
    ),
    h('p', null, 'You use River Guide at your own risk. River Guide and its contributors accept no liability for any loss, injury or damage arising from its use.'),
  ];
}

/** Show the terms as a dialog that can't be dismissed until they are accepted. Does nothing once accepted. */
export function requireTerms(): void {
  if (accepted()) return;
  const tick = h('input', { type: 'checkbox', id: 'terms-accept' });
  const go = h('button', { type: 'submit', class: 'btn btn-primary terms-go', disabled: true }, 'Continue');
  tick.addEventListener('change', () => (go.disabled = !tick.checked));
  const form = h(
    'form',
    { method: 'dialog', class: 'terms-form' },
    h('h2', { id: 'terms-title' }, 'Before you use River Guide'),
    h('div', { class: 'terms-body' }, termsContent()),
    h('label', { class: 'terms-tick', for: 'terms-accept' }, tick, h('span', null, 'I understand and accept these terms')),
    go,
  );
  const dialog = h('dialog', { class: 'terms', 'aria-labelledby': 'terms-title' }, form);
  // Escape doesn't close it: only accepting does.
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  form.addEventListener('submit', (e) => {
    if (!tick.checked) {
      e.preventDefault();
      return;
    }
    remember();
  });
  dialog.addEventListener('close', () => {
    if (!accepted()) {
      dialog.showModal();
      return;
    }
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  tick.focus();
}
