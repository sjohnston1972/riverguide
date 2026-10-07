// Favourite rivers, kept on this device (localStorage). There are no accounts,
// so favourites don't follow a person between browsers or devices.

import { h, icon } from './dom.ts';
import { ICONS } from './icons.ts';

const KEY = 'rg:favourites';
export const FAVOURITES_EVENT = 'rg:favourites';

let cache: Set<string> | null = null;

function read(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function favourites(): ReadonlySet<string> {
  return (cache ??= read());
}

export function isFavourite(slug: string): boolean {
  return favourites().has(slug);
}

/** Adds or removes a river; returns whether it is now a favourite. */
export function toggleFavourite(slug: string): boolean {
  const next = new Set(favourites());
  const on = !next.has(slug);
  if (on) next.add(slug);
  else next.delete(slug);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* private mode or storage blocked: still works for this visit */
  }
  document.dispatchEvent(new CustomEvent(FAVOURITES_EVENT));
  return on;
}

// Another tab changed them.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  cache = null;
  document.dispatchEvent(new CustomEvent(FAVOURITES_EVENT));
});

/** A star toggle for one river. `name` can be updated later with setFavouriteName. */
export function favButton(slug: string, name: string, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `fav-btn ${cls}`.trim(), 'data-name': name }, icon(ICONS.star));
  const sync = () => {
    const on = isFavourite(slug);
    const n = b.dataset.name || 'this river';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? `Remove ${n} from favourites` : `Add ${n} to favourites`);
    b.title = on ? 'Remove from favourites' : 'Add to favourites';
  };
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavourite(slug);
    sync();
  });
  sync();
  return b;
}

export function setFavouriteName(b: HTMLButtonElement, name: string): void {
  b.dataset.name = name;
  const on = b.getAttribute('aria-pressed') === 'true';
  b.setAttribute('aria-label', on ? `Remove ${name} from favourites` : `Add ${name} to favourites`);
}
