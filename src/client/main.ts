import './styles.css';
import type { PublicConfig } from '../shared/types.ts';
import { api } from './api.ts';
import { clear, h, icon } from './dom.ts';
import { ICONS } from './icons.ts';
import { mountAbout } from './pages/about.ts';
import { mountList } from './pages/list.ts';
import { mountLora } from './pages/lora.ts';
import { mountNotFound } from './pages/notfound.ts';
import { mountReleases } from './pages/releases.ts';
import { mountRiver } from './pages/river.ts';
import { type Route, savedScroll, startRouter } from './router.ts';
import { initTheme, themeToggle } from './theme.ts';

export interface ChatContext {
  slug: string;
  name: string;
}

export interface AppCtx {
  config: () => PublicConfig | null;
  openChat: (context?: ChatContext) => void;
  setTitle: (title: string | null) => void;
}

export interface Page {
  /** Return true if the page handled the route change in place. */
  update?: (route: Route) => boolean;
  destroy?: () => void;
}

let config: PublicConfig | null = null;
let page: Page | null = null;
let pageName: Route['name'] | null = null;
let firstRender = true;

initTheme();

const navLinks: Record<string, HTMLAnchorElement> = {
  list: h('a', { href: '/', class: 'nav-link' }, 'Rivers'),
  map: h('a', { href: '/map', class: 'nav-link' }, 'Map'),
  releases: h('a', { href: '/releases', class: 'nav-link' }, 'Releases'),
  lora: h('a', { href: '/falls-of-lora', class: 'nav-link', 'aria-label': 'Falls of Lora' }, h('span', { class: 'nav-long' }, 'Falls of Lora'), h('span', { class: 'nav-short', 'aria-hidden': 'true' }, 'Lora')),
  about: h('a', { href: '/about', class: 'nav-link nav-about' }, 'About'),
};

const header = h(
  'header',
  { class: 'site-header' },
  h(
    'div',
    { class: 'wrap header-inner' },
    h('a', { href: '/', class: 'brand', 'aria-label': 'River Guide home' }, h('img', { class: 'brand-light', src: '/icons/logo-64.png', srcset: '/icons/logo-64.png 2x, /icons/logo-128.png 4x', alt: '', width: 32, height: 32 }),
    h('img', { class: 'brand-dark', src: '/icons/logo-64-dark.png', srcset: '/icons/logo-64-dark.png 2x, /icons/logo-128-dark.png 4x', alt: '', width: 32, height: 32 }), h('span', null, 'River Guide')),
    h('nav', { class: 'site-nav', 'aria-label': 'Main' }, Object.values(navLinks)),
    themeToggle(),
  ),
);

const main = h('main', { id: 'main', class: 'site-main', tabindex: '-1' });

const footer = h(
  'footer',
  { class: 'site-footer' },
  h(
    'div',
    { class: 'wrap' },
    h(
      'p',
      null,
      'River levels: contains SEPA data © Scottish Environment Protection Agency and database right. Dam releases: SSE freshet schedule via SEPA. Paddler levels and extra sections adapted from ',
      h('a', { href: 'https://www.andyjacksonfund.org.uk/wheres-the-water/', target: '_blank', rel: 'noopener' }, "Where's the Water"),
      ' (Scottish Canoe Association), ',
      h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY-SA 4.0'),
      '. Weather: Open-Meteo. Maps © OpenStreetMap contributors.',
    ),
    h('p', null, h('a', { href: '/about' }, 'About River Guide, data sources and licences')),
  ),
);

const chatButton = h(
  'button',
  { class: 'chat-fab', type: 'button', hidden: true, 'aria-label': 'Ask River Guide', onclick: () => openChat() },
  icon(ICONS.chat),
  h('span', { class: 'chat-fab-label' }, 'Ask'),
);

const skip = h('a', { href: '#main', class: 'skip-link', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content');

const root = document.getElementById('root') ?? document.body;
clear(root);
root.append(skip, header, main, footer, chatButton);

function openChat(context?: ChatContext): void {
  if (!config?.chat_enabled) return;
  void import('./chat.ts').then((m) => m.openChat(config!, context));
}

const ctx: AppCtx = {
  config: () => config,
  openChat,
  setTitle: (t) => {
    document.title = t ? `${t} | River Guide` : 'River Guide: Scottish river levels for paddlers';
  },
};

api
  .config()
  .then((c) => {
    config = c;
    chatButton.hidden = !c.chat_enabled;
    document.dispatchEvent(new CustomEvent('rg:config'));
  })
  .catch(() => {
    config = { chat_enabled: false, community_enabled: false, turnstile_site_key: null, show_full_guide_text: false };
  });

/**
 * Back/forward: return to where the user was. Pages fill in after their data loads, so keep
 * re-applying the position until the page is tall enough, for up to 5 s or until the user
 * scrolls or taps.
 */
let cancelRestore: (() => void) | null = null;
function restoreScroll(y: number): void {
  cancelRestore?.();
  const until = Date.now() + 5000;
  let timer = 0;
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
  const stop = () => {
    clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, stop);
    cancelRestore = null;
  };
  const step = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 1 && Date.now() < until) timer = window.setTimeout(step, 50);
    else stop();
  };
  for (const e of events) window.addEventListener(e, stop, { passive: true });
  cancelRestore = stop;
  step();
}

function render(route: Route, nav: { pop: boolean }): void {
  for (const [name, a] of Object.entries(navLinks)) {
    const active =
      name === route.name ||
      (name === 'list' && route.name === 'river' && route.slug !== 'falls-of-lora-tidal-rapid') ||
      (name === 'lora' && route.name === 'river' && route.slug === 'falls-of-lora-tidal-rapid');
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.dispatchEvent(new CustomEvent('rg:navigate'));

  // List and map are one page with two views: switch in place to keep state.
  const sameFamily = (a: string | null, b: string) => (a === 'list' || a === 'map') && (b === 'list' || b === 'map');
  if (page?.update && (pageName === route.name || sameFamily(pageName, route.name)) && page.update(route)) {
    pageName = route.name;
    return;
  }

  page?.destroy?.();
  clear(main);
  pageName = route.name;
  switch (route.name) {
    case 'list':
    case 'map':
      page = mountList(main, route, ctx);
      break;
    case 'river':
      page = mountRiver(main, route.slug, ctx);
      break;
    case 'releases':
      page = mountReleases(main, route, ctx);
      break;
    case 'lora':
      page = mountLora(main, route, ctx);
      break;
    case 'about':
      page = mountAbout(main, ctx);
      break;
    default:
      page = mountNotFound(main, ctx);
  }
  cancelRestore?.();
  const y = nav.pop ? savedScroll() : null;
  if (y != null) restoreScroll(y);
  else window.scrollTo(0, 0);
  // Move focus for screen readers without scrolling.
  const h1 = main.querySelector('h1');
  if (h1 && !firstRender) {
    h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
  }
  firstRender = false;
}

startRouter(render);

// Offline support (public/sw.js): the app and the last levels seen still open with no signal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
