// "Feedback and bugs" form on the About page. Messages go to the maintainer as private GitHub issues.

import { FEEDBACK_KINDS, type FeedbackKind } from '../shared/feedback.ts';
import { api } from './api.ts';
import { h } from './dom.ts';
import { TurnstileWidget } from './turnstile.ts';

const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Problem', idea: 'Idea', other: 'Other' };
const PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: 'What happened, and what did you expect? Name the river if it’s about one.',
  idea: 'What would make River Guide more useful?',
  other: 'Your message',
};

export interface FeedbackFormOptions {
  siteKey: () => string | null;
  /** The page the sender was on before About, sent with bug reports. */
  previousPath: () => string | null;
}

export function feedbackForm(o: FeedbackFormOptions): HTMLElement {
  const root = h('div', { class: 'feedback' });
  let widget: TurnstileWidget | null = null;

  function form(): HTMLElement {
    let kind: FeedbackKind | null = null;
    const msg = h('p', { class: 'form-msg', role: 'status' });
    const message = h('textarea', { class: 'field', rows: 5, maxlength: 4000, placeholder: 'Choose a type first', required: true });
    const email = h('input', { class: 'field', type: 'email', maxlength: 200, autocomplete: 'email', placeholder: 'you@example.com' });
    const tsBox = h('div', { class: 'community-check' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Send');
    const sync = () => (submit.disabled = !kind || message.value.trim().length < 5);
    message.addEventListener('input', sync);

    const kindBtns = FEEDBACK_KINDS.map((k) => {
      const b = h('button', { type: 'button', class: 'verdict', 'aria-pressed': 'false' }, KIND_LABEL[k]);
      b.addEventListener('click', () => {
        kind = k;
        kindBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        message.placeholder = PLACEHOLDER[k];
        sync();
      });
      return b;
    });

    const f = h(
      'form',
      { class: 'report-form' },
      h('fieldset', null, h('legend', null, 'What’s it about?'), h('div', { class: 'feedback-kinds' }, kindBtns)),
      h('label', { class: 'note-label' }, 'Message', message),
      h('label', { class: 'note-label' }, 'Email (optional, if you’d like a reply)', email),
      tsBox,
      h('div', { class: 'form-actions' }, submit),
      msg,
      h('p', { class: 'fine-print' }, 'Your message goes privately to the maintainer, with the page you came from and your browser type to help track down bugs. It isn’t published.'),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const chosen = kind;
      if (!chosen) return;
      submit.disabled = true;
      msg.textContent = 'Sending…';
      const key = o.siteKey();
      (async () => {
        let token: string | undefined;
        if (key) {
          widget ??= new TurnstileWidget(tsBox, key);
          token = await widget.token();
        }
        await api.sendFeedback({
          kind: chosen,
          message: message.value,
          email: email.value.trim() || undefined,
          page: o.previousPath() ?? undefined,
          screen: `${window.innerWidth}x${window.innerHeight}`,
          token,
        });
      })()
        .then(() => {
          widget = null;
          root.replaceChildren(sent());
        })
        .catch((err: unknown) => {
          sync();
          msg.textContent = err instanceof Error ? err.message : 'Couldn’t send your message.';
        });
    });
    return f;
  }

  function sent(): HTMLElement {
    return h(
      'div',
      { class: 'notice notice-ok feedback-sent', role: 'status' },
      h('p', null, 'Thanks — your message has been sent.'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: () => root.replaceChildren(form()) }, 'Send another'),
    );
  }

  root.append(form());
  return root;
}
