// Light/dark theme: follows prefers-color-scheme until the user picks one.

import { h, icon } from './dom.ts';
import { ICONS } from './icons.ts';

type Theme = 'light' | 'dark';
const KEY = 'rg-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function effectiveTheme(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return media.matches ? 'dark' : 'light';
}

function apply(): void {
  const t = stored();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', effectiveTheme() === 'dark' ? '#0f1b20' : '#eef3f1');
  document.dispatchEvent(new CustomEvent('rg:theme'));
}

export function initTheme(): void {
  apply();
  media.addEventListener('change', () => {
    if (!stored()) apply();
  });
}

export function themeToggle(): HTMLButtonElement {
  const btn = h('button', { class: 'icon-btn theme-toggle', type: 'button' });
  const paint = () => {
    const dark = effectiveTheme() === 'dark';
    btn.replaceChildren(icon(dark ? ICONS.sun : ICONS.moon));
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    btn.title = btn.getAttribute('aria-label')!;
  };
  btn.addEventListener('click', () => {
    const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try {
      // Picking the system theme again returns to "follow the system".
      if (next === (media.matches ? 'dark' : 'light')) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      document.documentElement.dataset.theme = next;
      document.dispatchEvent(new CustomEvent('rg:theme'));
      paint();
      return;
    }
    apply();
    paint();
  });
  document.addEventListener('rg:theme', paint);
  paint();
  return btn;
}

/** Read a CSS custom property (for canvas drawing). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
