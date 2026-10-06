// Small shared UI pieces.

import type { Confidence, SectionStatus, StatusBasis, Trend } from '../shared/types.ts';
import { h } from './dom.ts';
import { COMMUNITY_TOOLTIP, ESTIMATE_TOOLTIP, formatLevel, STATUS_LABEL, TREND_ARROW, TREND_LABEL } from './labels.ts';

export function statusPill(status: SectionStatus, size: 'sm' | 'lg' = 'sm'): HTMLSpanElement {
  return h('span', { class: `pill pill-${status} pill-${size}` }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), STATUS_LABEL[status]);
}

export function estimateMark(basis: StatusBasis, confidence: Confidence | null = null): HTMLElement | null {
  if (basis === 'community') {
    const tip = confidence ? `${COMMUNITY_TOOLTIP} (${confidence} confidence)` : COMMUNITY_TOOLTIP;
    return h('abbr', { class: 'est est-community', title: tip, 'aria-label': tip }, 'community');
  }
  if (basis !== 'estimate') return null;
  const tip = confidence ? `${ESTIMATE_TOOLTIP} (${confidence} confidence)` : ESTIMATE_TOOLTIP;
  return h('abbr', { class: `est est-${confidence ?? 'unknown'}`, title: tip, 'aria-label': `Estimate: ${tip}` }, 'est.');
}

export function levelWithTrend(level: number | null, trend: Trend, stale = false): HTMLSpanElement {
  const arrow = TREND_ARROW[trend];
  return h(
    'span',
    { class: `lvl trend-${trend}${stale ? ' lvl-stale' : ''}` },
    h('span', { class: 'lvl-num' }, formatLevel(level)),
    arrow && level != null && !stale ? h('span', { class: 'lvl-arrow', title: TREND_LABEL[trend], 'aria-label': TREND_LABEL[trend] }, arrow) : null,
    stale ? h('span', { class: 'lvl-stale-tag', title: 'Last reading is more than 3 hours old' }, 'old') : null,
  );
}

export function errorBox(message: string, retry?: () => void): HTMLDivElement {
  return h(
    'div',
    { class: 'notice notice-error', role: 'alert' },
    h('p', null, message),
    retry ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: retry }, 'Retry') : null,
  );
}

export function skeletonLines(n: number, cls = 'skel-row'): HTMLDivElement {
  return h('div', { class: 'skel-wrap', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: `skel ${cls}` })));
}

export function loadingText(text: string): HTMLParagraphElement {
  return h('p', { class: 'muted loading', role: 'status' }, text);
}
