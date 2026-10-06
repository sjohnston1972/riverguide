// Minimal History API router.

export type Route =
  | { name: 'list'; search: string }
  | { name: 'map'; search: string }
  | { name: 'river'; slug: string; search: string }
  | { name: 'about'; search: string }
  | { name: 'notfound'; search: string };

export function matchRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'list', search };
  if (path === '/map') return { name: 'map', search };
  if (path === '/about') return { name: 'about', search };
  const m = /^\/river\/([a-z0-9-]{1,120})$/i.exec(path);
  if (m) return { name: 'river', slug: m[1].toLowerCase(), search };
  return { name: 'notfound', search };
}

type Listener = (route: Route, nav: { pop: boolean }) => void;
let listener: Listener | null = null;

export function currentRoute(): Route {
  return matchRoute(location.pathname, location.search);
}

export function navigate(url: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  listener?.(currentRoute(), { pop: false });
}

/** Update the URL (e.g. filter state) without re-rendering. */
export function replaceUrl(url: string): void {
  if (url !== location.pathname + location.search) history.replaceState(history.state, '', url);
}

export function startRouter(onRoute: Listener): void {
  listener = onRoute;
  window.addEventListener('popstate', () => onRoute(currentRoute(), { pop: true }));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(href);
  });
  onRoute(currentRoute(), { pop: false });
}
