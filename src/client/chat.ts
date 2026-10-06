// Chat slide-over panel (lazy-loaded on first open).

import type { ChatCard, ChatEvent, ChatRequest, ChatTurn, PublicConfig } from '../shared/types.ts';
import { api, errorFrom } from './api.ts';
import { estimateMark, levelWithTrend, statusPill } from './components.ts';
import { clear, h, icon } from './dom.ts';
import { formatMessage } from './format.ts';
import type { LevelGraph } from './graph.ts';
import { ICONS } from './icons.ts';
import { gradeLabel } from './labels.ts';
import type { ChatContext } from './main.ts';
import { SseParser } from './sse.ts';
import { TurnstileWidget } from './turnstile.ts';

type Part = { t: 'text'; s: string } | { t: 'card'; card: ChatCard };
type Entry = { role: 'user'; text: string } | { role: 'assistant'; parts: Part[]; error?: string; stopped?: boolean };

interface Saved {
  entries: Entry[];
  context: ChatContext | null;
}

const STORE_KEY = 'rg-chat-v1';
const DISCLAIMER_KEY = 'rg-chat-accepted-v1';
const MAX_INPUT = 1000;
const MAX_TURN = 4000;
const MAX_TURNS = 30;

const DISCLAIMER =
  "River Guide gives planning information only. Levels and 'runnable' estimates can be wrong and hazards change. You are responsible for your own safety.";
const GENERAL_PROMPTS = ["What's running in the West Highlands?", 'Is the Etive worth a look this weekend?', 'Grade 3 rivers running near Fort William'];

// ---- Persistence ----
function loadSaved(): Saved {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.entries)) return { entries: s.entries, context: s.context ?? null };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { entries: [], context: null };
}

function save(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ entries, context } satisfies Saved));
  } catch {
    /* ignore */
  }
}

function accepted(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === '1';
  } catch {
    return acceptedThisPage;
  }
}

const saved = loadSaved();
let entries: Entry[] = saved.entries;
let context: ChatContext | null = saved.context;
let acceptedThisPage = false;
let cfg: PublicConfig;
let streaming: AbortController | null = null;
let sessionPromise: Promise<void> | null = null;
let widget: TurnstileWidget | null = null;
/** Bumped by "New chat" so an in-flight answer doesn't land in the new conversation. */
let generation = 0;
let rendered = false;
const graphs = new Set<LevelGraph>();

// ---- DOM ----
const titleId = 'chat-title';
const panel = h('div', { class: 'chat-panel', role: 'dialog', 'aria-labelledby': titleId, 'aria-modal': 'false', hidden: true });
const newBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', title: 'Start a new conversation' }, icon(ICONS.plus), 'New chat');
const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close chat' }, icon(ICONS.close));
const contextBar = h('div', { class: 'chat-context' });
const body = h('div', { class: 'chat-body' });
const log = h('div', { class: 'chat-log' });
const suggestions = h('div', { class: 'chat-suggest' });
const verify = h('div', { class: 'chat-verify' });
const verifyWidget = h('div', { class: 'chat-verify-widget' });
const verifyMsg = h('p', { class: 'chat-verify-msg', role: 'status' });
verify.append(verifyWidget, verifyMsg);
const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
const input = h('textarea', {
  class: 'chat-input',
  rows: 1,
  maxlength: MAX_INPUT,
  placeholder: 'Ask about rivers, levels or the forecast',
  'aria-label': 'Your question',
  enterkeyhint: 'send',
});
const sendBtn = h('button', { type: 'submit', class: 'chat-send', 'aria-label': 'Send' }, icon(ICONS.send));
const stopBtn = h('button', { type: 'button', class: 'chat-stop', hidden: true }, icon(ICONS.stop), 'Stop');
const form = h('form', { class: 'chat-form' }, input, sendBtn, stopBtn);
const chatView = h('div', { class: 'chat-view' }, contextBar, body, verify, form, h('p', { class: 'chat-foot' }, 'Answers can be wrong. Check the river page and guidebook before paddling.'));
body.append(log, suggestions);

panel.append(
  h('header', { class: 'chat-head' }, h('h2', { id: titleId }, icon(ICONS.wave), 'Ask River Guide'), h('div', { class: 'chat-head-actions' }, newBtn, closeBtn)),
  chatView,
  live,
);

let built = false;
function build(): void {
  if (built) return;
  built = true;
  document.body.append(panel);

  closeBtn.addEventListener('click', () => closeChat());
  newBtn.addEventListener('click', () => {
    streaming?.abort();
    generation++;
    entries = [];
    save();
    renderAll();
    input.focus();
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChat();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && !streaming) void send(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', autosize);
  stopBtn.addEventListener('click', () => streaming?.abort());
  // Full-screen on phones: get out of the way when a link inside chat navigates.
  document.addEventListener('rg:navigate', () => {
    if (!panel.hidden && window.matchMedia('(max-width: 719px)').matches) closeChat(false);
  });
}

function autosize(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

// ---- Open / close ----
export function openChat(config: PublicConfig, ctx?: ChatContext): void {
  cfg = config;
  build();
  if (ctx && ctx.slug !== context?.slug) {
    context = ctx;
    save();
  }
  panel.hidden = false;
  document.documentElement.classList.add('chat-open');
  requestAnimationFrame(() => panel.classList.add('open'));
  if (!accepted()) {
    showDisclaimer();
    return;
  }
  showChat();
}

function closeChat(restoreFocus = true): void {
  panel.classList.remove('open');
  document.documentElement.classList.remove('chat-open');
  panel.hidden = true;
  if (restoreFocus) (document.querySelector('.chat-fab') as HTMLElement | null)?.focus();
}

function showDisclaimer(): void {
  const ok = h('button', { type: 'button', class: 'btn btn-primary' }, 'I understand');
  const box = h(
    'div',
    { class: 'chat-disclaimer' },
    h('h3', null, 'Before you ask'),
    h('p', null, DISCLAIMER),
    h('p', { class: 'muted' }, 'Answers are generated by an AI model from SEPA gauges, forecasts and guidebook summaries. Always read the full guidebook write-up and look at the river yourself.'),
    ok,
  );
  chatView.hidden = true;
  panel.querySelector('.chat-disclaimer')?.remove();
  panel.insertBefore(box, chatView);
  ok.addEventListener('click', () => {
    acceptedThisPage = true;
    try {
      localStorage.setItem(DISCLAIMER_KEY, '1');
    } catch {
      /* remembered for this page only */
    }
    box.remove();
    showChat();
  });
  ok.focus();
}

function showChat(): void {
  chatView.hidden = false;
  if (!rendered) renderAll();
  else {
    renderContext();
    renderSuggestions();
  }
  void ensureSession().catch(() => undefined);
  if (!streaming) input.focus();
}

// ---- Session (Turnstile -> cookie) ----
function ensureSession(force = false): Promise<void> {
  if (!force && sessionPromise) return sessionPromise;
  const p = (async () => {
    let body: { token?: string } = {};
    if (cfg.turnstile_site_key) {
      verify.hidden = false;
      verifyMsg.textContent = 'Checking you are human…';
      widget ??= new TurnstileWidget(verifyWidget, cfg.turnstile_site_key);
      body = { token: await widget.token() };
    }
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (!res.ok) throw await errorFrom(res);
  })();
  sessionPromise = p;
  p.then(
    () => {
      verifyMsg.textContent = '';
      verify.hidden = true;
    },
    (e: Error) => {
      if (sessionPromise === p) sessionPromise = null;
      verify.hidden = false;
      verifyMsg.replaceChildren(
        `Chat couldn't start: ${e.message} `,
        h('button', { type: 'button', class: 'link-btn', onclick: () => void ensureSession(true).catch(() => undefined) }, 'Try again'),
      );
    },
  );
  return p;
}

// ---- Rendering ----
function renderAll(): void {
  rendered = true;
  for (const g of graphs) g.destroy();
  graphs.clear();
  renderContext();
  clear(log);
  for (const e of entries) log.append(e.role === 'user' ? userBubble(e.text) : assistantBlock(e).el);
  renderSuggestions();
  setStreaming(!!streaming);
  scrollToEnd(true);
}

function renderContext(): void {
  clear(contextBar);
  contextBar.hidden = !context;
  if (!context) return;
  contextBar.append(
    h('span', null, 'Asking about ', h('a', { href: `/river/${encodeURIComponent(context.slug)}` }, context.name)),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn icon-btn-sm',
        'aria-label': 'Stop asking about this river',
        onclick: () => {
          context = null;
          save();
          renderContext();
          renderSuggestions();
        },
      },
      icon(ICONS.close),
    ),
  );
}

function renderSuggestions(): void {
  clear(suggestions);
  if (entries.length) return;
  const prompts = context
    ? [`Is ${context.name} running today?`, `What's the rain forecast for ${context.name}?`, `What should I know before paddling ${context.name}?`]
    : GENERAL_PROMPTS;
  suggestions.append(
    h('p', { class: 'muted' }, context ? 'Try asking:' : 'Ask about levels, rivers or the forecast. For example:'),
    ...prompts.map((p) => h('button', { type: 'button', class: 'suggest-btn', onclick: () => void send(p) }, p)),
  );
}

function userBubble(text: string): HTMLElement {
  return h('div', { class: 'msg msg-user' }, h('p', null, text));
}

interface AssistantView {
  el: HTMLElement;
  addText(delta: string): void;
  addCard(card: ChatCard): void;
  setStatus(label: string | null): void;
  setError(message: string): void;
  setStopped(): void;
}

function assistantBlock(entry: Extract<Entry, { role: 'assistant' }>): AssistantView {
  const el = h('div', { class: 'msg msg-assistant' });
  const status = h('p', { class: 'msg-status', hidden: true });
  let textEl: HTMLElement | null = null;
  let textPart: { t: 'text'; s: string } | null = null;
  let frame = 0;

  const paint = () => {
    frame = 0;
    if (textEl && textPart) textEl.innerHTML = formatMessage(textPart.s);
  };
  const newText = (part: { t: 'text'; s: string }) => {
    textPart = part;
    textEl = h('div', { class: 'msg-text' });
    el.insertBefore(textEl, status);
  };
  el.append(status);

  for (const p of entry.parts) {
    if (p.t === 'text') {
      newText(p);
      paint();
    } else {
      el.insertBefore(cardView(p.card), status);
      textEl = null;
      textPart = null;
    }
  }
  if (entry.error) el.insertBefore(h('p', { class: 'msg-error' }, entry.error), status);
  if (entry.stopped) el.insertBefore(h('p', { class: 'msg-stopped muted' }, 'Stopped.'), status);

  return {
    el,
    addText(delta) {
      if (!textPart) {
        const part: Part = { t: 'text', s: '' };
        entry.parts.push(part);
        newText(part);
      }
      textPart!.s += delta;
      status.hidden = true;
      if (!frame) frame = requestAnimationFrame(paint);
    },
    addCard(card) {
      entry.parts.push({ t: 'card', card });
      el.insertBefore(cardView(card), status);
      textEl = null;
      textPart = null;
    },
    setStatus(label) {
      status.hidden = !label;
      status.textContent = label ? `${label}…` : '';
      if (label) live.textContent = `${label}…`;
    },
    setError(message) {
      entry.error = message;
      el.insertBefore(h('p', { class: 'msg-error' }, message), status);
    },
    setStopped() {
      entry.stopped = true;
      el.insertBefore(h('p', { class: 'msg-stopped muted' }, 'Stopped.'), status);
    },
  };
}

function cardView(card: ChatCard): HTMLElement {
  if (card.kind === 'section') {
    const box = h('div', { class: 'chat-card card-section' }, h('div', { class: 'skel skel-row', 'aria-hidden': 'true' }));
    api
      .section(card.slug)
      .then((s) => {
        const href = `/river/${encodeURIComponent(s.slug)}`;
        box.replaceChildren(
          h('a', { class: 'card-name', href }, s.name),
          h('p', { class: 'card-meta' }, `${gradeLabel(s.grade_text)}, ${s.region}`),
          h('p', { class: 'card-status' }, statusPill(s.status), estimateMark(s.status_basis), s.level != null ? levelWithTrend(s.level, s.trend) : null),
          h('a', { class: 'card-link', href }, 'Open river page'),
        );
        box.classList.add(`st-${s.status}`);
      })
      .catch(() => box.replaceChildren(h('p', { class: 'muted' }, `Couldn't load section "${card.slug}".`)));
    return box;
  }
  const area = h('div', { class: 'card-graph-area' }, h('div', { class: 'skel skel-graph', 'aria-hidden': 'true' }));
  Promise.all([api.history(card.station_no, card.period), import('./graph.ts')])
    .then(([hist, mod]) => {
      area.replaceChildren();
      if (!hist.points.length) {
        area.append(h('p', { class: 'muted' }, 'No readings for this period.'));
        return;
      }
      graphs.add(mod.levelGraph(area, hist.points, { height: 180 }));
    })
    .catch(() => area.replaceChildren(h('p', { class: 'muted' }, "Couldn't load the level graph.")));
  return h('div', { class: 'chat-card card-graph' }, h('p', { class: 'card-graph-label' }, card.label), area);
}

function setStreaming(on: boolean): void {
  input.disabled = on;
  sendBtn.hidden = on;
  stopBtn.hidden = !on;
  newBtn.disabled = false;
  panel.classList.toggle('is-streaming', on);
}

function scrollToEnd(force = false): void {
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  if (force || nearBottom) body.scrollTop = body.scrollHeight;
}

// ---- Sending ----
function assistantText(e: Extract<Entry, { role: 'assistant' }>): string {
  return e.parts
    .filter((p): p is { t: 'text'; s: string } => p.t === 'text')
    .map((p) => p.s)
    .join('')
    .trim();
}

/** Plain-text history for the API: drops user turns that never got an answer. */
function history(): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.role !== 'user') continue;
    const next = entries[i + 1];
    const reply = next?.role === 'assistant' ? assistantText(next) : '';
    if (i === entries.length - 1) turns.push({ role: 'user', content: e.text.slice(0, MAX_TURN) });
    else if (reply) turns.push({ role: 'user', content: e.text.slice(0, MAX_TURN) }, { role: 'assistant', content: reply.slice(0, MAX_TURN) });
  }
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

async function postChat(signal: AbortSignal): Promise<Response> {
  const req: ChatRequest = { messages: history() };
  if (context) req.context_slug = context.slug;
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(req),
    signal,
    credentials: 'same-origin',
  });
}

async function send(text: string): Promise<void> {
  if (streaming) return;
  const q = text.slice(0, MAX_INPUT);
  entries.push({ role: 'user', text: q });
  log.append(userBubble(q));
  input.value = '';
  autosize();
  renderSuggestions();

  const entry: Extract<Entry, { role: 'assistant' }> = { role: 'assistant', parts: [] };
  const view = assistantBlock(entry);
  log.append(view.el);
  view.setStatus('Thinking');
  scrollToEnd(true);
  save();

  const ctrl = new AbortController();
  const gen = generation;
  streaming = ctrl;
  setStreaming(true);
  live.textContent = 'River Guide is answering.';

  try {
    await ensureSession();
    let res = await postChat(ctrl.signal);
    if (res.status === 401) {
      const err = await errorFrom(res);
      if (err.code !== 'session') throw err;
      await ensureSession(true);
      res = await postChat(ctrl.signal);
    }
    if (!res.ok || !res.body) {
      const err = await errorFrom(res);
      view.setStatus(null);
      view.setError(err.message);
      return;
    }
    await readStream(res.body, view, ctrl.signal);
  } catch (e) {
    view.setStatus(null);
    if (ctrl.signal.aborted) view.setStopped();
    else view.setError(e instanceof Error && e.message && !/fetch|network/i.test(e.message) ? e.message : 'Lost the connection. Check your signal and try again.');
  } finally {
    view.setStatus(null);
    if (streaming === ctrl) streaming = null;
    // Pushed after the stream so history() during the request ends on the user turn.
    if (gen === generation) entries.push(entry);
    save();
    setStreaming(false);
    live.textContent = entry.error ? 'Answer failed.' : 'Answer ready.';
    scrollToEnd();
    if (!panel.hidden) input.focus();
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, view: AssistantView, signal: AbortSignal): Promise<void> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const data of parser.push(dec.decode(value, { stream: true }))) {
        let ev: ChatEvent;
        try {
          ev = JSON.parse(data) as ChatEvent;
        } catch {
          continue;
        }
        switch (ev.type) {
          case 'text':
            view.addText(ev.text);
            break;
          case 'status':
            view.setStatus(ev.label);
            break;
          case 'card':
            view.setStatus(null);
            view.addCard(ev.card);
            break;
          case 'error':
            view.setStatus(null);
            view.setError(ev.message);
            break;
          case 'done':
            return;
        }
        scrollToEnd();
      }
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
