// Installed app (Android especially): a stray back swipe shouldn't close River Guide.
// - Opened straight onto a page other than the list (a shared link, a shortcut): Back goes to the
//   list first, rather than out of the app.
// - On the list with nowhere further back: the first Back stays in the app and says "Swipe back
//   again to close River Guide"; a second Back closes it.
// Browsers skip history entries added without a tap or key press, so the extra entry is only
// added on the next tap. Only in the installed app: in a browser tab, Back works as usual.

import { h } from './dom.ts';

interface GuardState {
  rgBase?: boolean;
  rgGuard?: boolean;
}

const state = (): GuardState => (history.state ?? {}) as GuardState;
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

let toast: HTMLElement | null = null;
let toastTimer = 0;

function showToast(text: string): void {
  toast ??= h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  if (!toast.isConnected) document.body.append(toast);
  toast.textContent = text;
  toast.classList.add('is-shown');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove('is-shown'), 2500);
}

/** Add the guard entry above the base one, if we're on the base entry. Needs a user gesture. */
function arm(): void {
  if (!state().rgBase) return;
  history.pushState({ rgGuard: true, scrollY: window.scrollY }, '', location.href);
}

export function startBackGuard(): void {
  // Only when nothing of ours is behind this page (the app was just opened).
  const nav = (window as { navigation?: { canGoBack: boolean } }).navigation;
  if (!installed() || (nav ? nav.canGoBack : history.length > 1)) return;
  // The entry the app opened on: from anywhere but the list, put the list beneath it.
  const opened = location.pathname + location.search + location.hash;
  const atList = location.pathname === '/';
  let rewritten = atList;
  history.replaceState({ ...state(), rgBase: true }, '');

  const onGesture = () => {
    if (!rewritten) {
      rewritten = true;
      history.replaceState({ rgBase: true }, '', '/');
      history.pushState({ scrollY: 0 }, '', opened);
      return;
    }
    arm();
  };
  // touchend, click and keydown all count as a user gesture.
  for (const type of ['touchend', 'click', 'keydown'] as const) window.addEventListener(type, onGesture, { capture: true, passive: true });

  let wasGuard = false;
  window.addEventListener('popstate', () => {
    if (state().rgBase && wasGuard) showToast('Swipe back again to close River Guide');
    wasGuard = !!state().rgGuard;
  });
  // The router pushes plain entries; the guard is the only one marked.
  const push = history.pushState.bind(history);
  history.pushState = (data, unused, url) => {
    push(data, unused, url);
    wasGuard = !!(data as GuardState | null)?.rgGuard;
  };
}
