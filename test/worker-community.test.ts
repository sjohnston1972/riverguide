import { describe, expect, it } from 'vitest';
import { cleanNote, ukDay } from '../src/worker/community.ts';

describe('ukDay', () => {
  it('uses the UK calendar day, not the UTC date', () => {
    // 00:30 BST on 8 October is 23:30Z on the 7th.
    expect(ukDay('2026-10-07T23:30:00.000Z')).toBe('2026-10-08');
    expect(ukDay('2026-10-07T22:30:00.000Z')).toBe('2026-10-07');
    // In winter (GMT) the two agree.
    expect(ukDay('2026-12-07T23:30:00.000Z')).toBe('2026-12-07');
  });
});

describe('cleanNote', () => {
  it('strips control characters, collapses whitespace, caps length and drops empty notes', () => {
    expect(cleanNote('  good\n\tlevel \u0007 ')).toBe('good level');
    expect(cleanNote('x'.repeat(400))).toHaveLength(280);
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});
