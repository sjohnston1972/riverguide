// Leaflet, loaded on demand (dynamic import keeps it out of the list page bundle).

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SectionStatus } from '../shared/types.ts';

export { L };

export const SCOTLAND_BOUNDS: L.LatLngBoundsExpression = [
  [54.6, -7.8],
  [58.8, -0.9],
];

export function baseMap(el: HTMLElement, opts: L.MapOptions = {}): L.Map {
  const map = L.map(el, opts);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    // Keep more off-screen tiles so fewer blank squares appear while dragging.
    keepBuffer: 4,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

export function cssColor(name: string, fallback = '#777'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function statusColor(status: SectionStatus): string {
  return cssColor(`--st-${status}`);
}
