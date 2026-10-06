import { describe, expect, it } from 'vitest';
import { findGridRefs, gridRefToEastingNorthing, gridRefToLatLon } from '../src/shared/osgrid.ts';

describe('gridRefToEastingNorthing', () => {
  it('decodes letters and digits to the centre of the square', () => {
    // NN 166 712 (Ben Nevis): 100 m square, centre +50 m
    expect(gridRefToEastingNorthing('NN166712')).toEqual({ e: 216650, n: 771250 });
    expect(gridRefToEastingNorthing('NN 16650 71250')).toEqual({ e: 216650.5, n: 771250.5 });
  });

  it('rejects malformed references', () => {
    expect(gridRefToEastingNorthing('NN12345')).toBeNull();
    expect(gridRefToEastingNorthing('II1234')).toBeNull();
    expect(gridRefToEastingNorthing('hello')).toBeNull();
  });
});

describe('gridRefToLatLon', () => {
  it('converts Ben Nevis summit to WGS84 within ~50 m', () => {
    const p = gridRefToLatLon('NN 16650 71250')!;
    expect(p.lat).toBeCloseTo(56.7969, 3);
    expect(p.lon).toBeCloseTo(-5.0036, 3);
  });

  it('converts a Southern Uplands reference (Moffat, NT 085 050)', () => {
    const p = gridRefToLatLon('NT085050')!;
    expect(p.lat).toBeCloseTo(55.333, 2);
    expect(p.lon).toBeCloseTo(-3.443, 2);
  });
});

describe('findGridRefs', () => {
  it('finds spaced and unspaced references and skips unbalanced digit groups', () => {
    const t = 'Layby at NN 23677 55387, bridge NN2438454319, and a phone number NN 123 4567.';
    expect(findGridRefs(t)).toEqual(['NN2367755387', 'NN2438454319']);
  });
});
