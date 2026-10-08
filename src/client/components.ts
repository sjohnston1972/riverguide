// Small shared UI pieces.

import type { Confidence, SectionStatus, SectionSummary, StatusBasis, Trend } from '../shared/types.ts';
import { h } from './dom.ts';
import { COMMUNITY_TOOLTIP, ESTIMATE_TOOLTIP, formatLevel, OUTLOOK_ARROW, STATUS_LABEL, STEP_LABEL, TREND_ARROW, TREND_LABEL } from './labels.ts';

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

/**
 * "↗ Runnable tomorrow" when tomorrow's predicted status, or failing that the paddler
 * step, differs from now. One rule for the list, the river page and the map.
 */
export function tomorrowTag(s: Pick<SectionSummary, 'outlook' | 'status' | 'status_tomorrow' | 'step' | 'step_tomorrow'>): HTMLElement | null {
  if (!s.outlook) return null;
  const changedStatus = s.status_tomorrow && s.status_tomorrow !== 'unknown' && s.status_tomorrow !== s.status;
  const changedStep = !changedStatus && s.step_tomorrow && s.step_tomorrow !== s.step;
  if (!changedStatus && !changedStep) return null;
  const label = changedStatus ? STATUS_LABEL[s.status_tomorrow!] : STEP_LABEL[s.step_tomorrow!];
  return h('span', { class: `tomorrow-tag outlook-${s.outlook}`, title: 'Rough estimate of tomorrow’s peak level' }, `${OUTLOOK_ARROW[s.outlook]} ${label} tomorrow`);
}

/** Why a section's status is Unknown, when the level beside it doesn't already say (no gauge / no reading). */
export function unknownReason(s: Pick<SectionSummary, 'status' | 'stale' | 'level' | 'status_basis'>): HTMLElement | null {
  if (s.status !== 'unknown' || s.level == null) return null;
  if (s.stale) return h('span', { class: 'reason-tag' }, 'Old reading');
  if (s.status_basis === 'typical') return h('span', { class: 'reason-tag' }, 'No band yet');
  return null;
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
