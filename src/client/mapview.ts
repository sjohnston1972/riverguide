// Sections map (lazy-loaded with Leaflet).

import type { SectionStatus, SectionSummary } from '../shared/types.ts';
import { estimateMark, levelWithTrend, statusPill } from './components.ts';
import { h } from './dom.ts';
import { gradeLabel, STATUS_LABEL } from './labels.ts';
import { baseMap, cssColor, L, SCOTLAND_BOUNDS, statusColor } from './maplib.ts';

export interface SectionsMap {
  setSections(list: SectionSummary[]): void;
  show(): void;
  destroy(): void;
}

const LEGEND: SectionStatus[] = ['runnable', 'low', 'high', 'unknown'];

function popup(s: SectionSummary): HTMLElement {
  return h(
    'div',
    { class: 'map-popup' },
    h('a', { class: 'popup-name', href: `/river/${encodeURIComponent(s.slug)}` }, s.name),
    h('p', { class: 'popup-meta' }, `${gradeLabel(s.grade_text)}, ${s.region}`),
    h('p', { class: 'popup-status' }, statusPill(s.status), estimateMark(s.status_basis, s.status_confidence), s.level != null ? levelWithTrend(s.level, s.trend, s.stale) : null),
    s.location_precision === 'approx' ? h('p', { class: 'popup-approx' }, 'Approximate location') : null,
    h('a', { class: 'popup-link', href: `/river/${encodeURIComponent(s.slug)}` }, 'Open river page'),
  );
}

export function createSectionsMap(el: HTMLElement): SectionsMap {
  const renderer = L.canvas({ padding: 0.5, tolerance: 8 });
  const map = baseMap(el, { renderer, preferCanvas: true });
  map.fitBounds(SCOTLAND_BOUNDS);
  const layer = L.layerGroup().addTo(map);
  let current: SectionSummary[] = [];
  let lastKey = '';

  const legend = new L.Control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const box = h(
      'div',
      { class: 'map-legend' },
      LEGEND.map((s) => h('div', { class: 'legend-item' }, h('span', { class: `legend-dot dot-${s}`, 'aria-hidden': 'true' }), STATUS_LABEL[s])),
      h('div', { class: 'legend-item' }, h('span', { class: 'legend-dot dot-approx', 'aria-hidden': 'true' }), 'Approximate location'),
    );
    L.DomEvent.disableClickPropagation(box);
    return box;
  };
  legend.addTo(map);

  function draw(): void {
    layer.clearLayers();
    const pts: L.LatLngTuple[] = [];
    // Runnable on top.
    const ordered = [...current].sort((a, b) => (a.status === 'runnable' ? 1 : 0) - (b.status === 'runnable' ? 1 : 0));
    for (const s of ordered) {
      if (s.lat == null || s.lon == null) continue;
      const color = statusColor(s.status);
      const approx = s.location_precision === 'approx';
      const m = L.circleMarker([s.lat, s.lon], {
        renderer,
        radius: approx ? 7 : 8,
        color: approx ? color : cssColor('--marker-ring', '#fff'),
        weight: approx ? 2.5 : 2,
        dashArray: approx ? '3 3' : undefined,
        fillColor: color,
        fillOpacity: approx ? 0.2 : 0.95,
      });
      m.bindPopup(() => popup(s), { maxWidth: 260 });
      // DOM content, never an HTML string: Leaflet sets string tooltips via innerHTML.
      m.bindTooltip(h('span', null, `${s.name}: ${STATUS_LABEL[s.status]}`), { direction: 'top', offset: [0, -6] });
      m.addTo(layer);
      pts.push([s.lat, s.lon]);
    }
    const key = current.map((s) => s.slug).join(',');
    if (key !== lastKey) {
      lastKey = key;
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 11, animate: false });
    }
  }

  const onTheme = () => draw();
  document.addEventListener('rg:theme', onTheme);

  return {
    setSections(list) {
      current = list;
      draw();
    },
    show() {
      map.invalidateSize();
    },
    destroy() {
      document.removeEventListener('rg:theme', onTheme);
      map.remove();
    },
  };
}
