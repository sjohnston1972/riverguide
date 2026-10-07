// Sections map (lazy-loaded with Leaflet).

import type { SectionStatus, SectionSummary } from '../shared/types.ts';
import { estimateMark, levelWithTrend, statusPill } from './components.ts';
import { h } from './dom.ts';
import { gradeLabel, STATUS_LABEL, STEP_LABEL } from './labels.ts';
import { baseMap, L, SCOTLAND_BOUNDS } from './maplib.ts';

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
    h('p', { class: 'popup-status' }, statusPill(s.status), s.step ? h('span', { class: `step-tag s-${s.step}` }, STEP_LABEL[s.step]) : estimateMark(s.status_basis, s.status_confidence), s.level != null ? levelWithTrend(s.level, s.trend, s.stale) : null),
    s.location_precision === 'approx' ? h('p', { class: 'popup-approx' }, 'Approximate location') : null,
    h('a', { class: 'popup-link', href: `/river/${encodeURIComponent(s.slug)}` }, 'Open river page'),
  );
}

export function createSectionsMap(el: HTMLElement): SectionsMap {
  // Markers are small DOM elements (divIcons), not a canvas: each one moves with
  // the map while dragging, so nothing is redrawn (or jumps) when the drag ends.
  const map = baseMap(el);
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
      const approx = s.location_precision === 'approx';
      const size = approx ? 16 : 18;
      const m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: `river-pin pin-${s.status}${approx ? ' pin-approx' : ''}`, html: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: `${s.name}: ${STATUS_LABEL[s.status]}`,
        alt: `${s.name}: ${STATUS_LABEL[s.status]}`,
        zIndexOffset: s.status === 'runnable' ? 1000 : 0,
        riseOnHover: true,
        // Let presses on a marker reach the map, so a drag can start anywhere
        // (Leaflet markers swallow them by default); a tap still opens the popup.
        bubblingMouseEvents: true,
      });
      m.bindPopup(() => popup(s), { maxWidth: 260 });
      // DOM content, never an HTML string: Leaflet sets string tooltips via innerHTML.
      m.bindTooltip(h('span', null, `${s.name}: ${STATUS_LABEL[s.status]}`), { direction: 'top', offset: [0, -10] });
      m.addTo(layer);
      pts.push([s.lat, s.lon]);
    }
    const key = current.map((s) => s.slug).join(',');
    if (key !== lastKey) {
      lastKey = key;
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 11, animate: false });
    }
  }

  return {
    setSections(list) {
      current = list;
      draw();
    },
    show() {
      map.invalidateSize();
    },
    destroy() {
      map.remove();
    },
  };
}
