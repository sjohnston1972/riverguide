import { describe, expect, it } from 'vitest';
import type { BandBasis, Confidence, Relation, SectionGaugeLink, SectionStatus } from '../src/shared/types.ts';
import { headline } from '../src/worker/data.ts';

const link = (station_no: string, basis: BandBasis, confidence: Confidence, relation: Relation, status: SectionStatus, banded = true): SectionGaugeLink =>
  ({
    station_no,
    relation,
    basis,
    confidence,
    min_level: banded ? 0.5 : null,
    max_level: banded ? 1.5 : null,
    status,
    gauge: { name: station_no },
  }) as SectionGaugeLink;

describe('headline', () => {
  it('takes the highest-precedence banded link, even when it is the least confident and furthest away', () => {
    const links = [
      link('est', 'duration', 'high', 'on-section', 'low'),
      link('wtw', 'paddler', 'low', 'proxy', 'runnable'),
      link('comm', 'community', 'medium', 'downstream', 'high'),
    ];
    expect(headline(links)).toMatchObject({ status: 'high', status_basis: 'community', link: { station_no: 'comm' } });
    expect(headline([...links, link('man', 'manual', 'low', 'proxy', 'runnable')])).toMatchObject({ status_basis: 'manual', link: { station_no: 'man' } });
    expect(headline(links.slice(0, 2))).toMatchObject({ status_basis: 'paddler', link: { station_no: 'wtw' } });
  });

  it('skips unbanded links, and is unknown when no link has a band', () => {
    const unbandedPaddler = link('wtw', 'paddler', 'medium', 'on-section', 'unknown', false);
    expect(headline([unbandedPaddler, link('est', 'duration', 'low', 'proxy', 'low')])).toMatchObject({ status: 'low', status_basis: 'estimate' });
    expect(headline([unbandedPaddler])).toMatchObject({ status: 'unknown', status_basis: 'typical' });
    expect(headline([])).toMatchObject({ status: 'unknown', status_basis: 'none', link: null });
  });
});
