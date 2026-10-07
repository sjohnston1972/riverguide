import { describe, expect, it } from 'vitest';
import { escapeHtml, formatMessage } from '../src/client/format.ts';
import { applyFilters, DEFAULT_FILTERS, filtersFromQuery, filtersToQuery } from '../src/client/filters.ts';
import { normalize, relativeTime } from '../src/client/labels.ts';
import { SseParser } from '../src/client/sse.ts';
import type { SectionSummary } from '../src/shared/types.ts';

// The only tags formatMessage itself emits.
const ALLOWED_TAGS = /<(\/?(h2|h3|strong|em|a|ul|li|br)\b[^>]*)>/gi;

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '"><b>break</b>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '[click](https://ok.example/" onmouseover="alert(1))',
  '[a](https://x.example/*b*)',
  '**<img src=x onerror=alert(1)>**',
  '- <script>alert(1)</script>',
  '## <iframe src=javascript:alert(1)>',
  '\u00000\u0000<script>alert(1)</script>',
];

describe('formatMessage XSS safety', () => {
  for (const payload of XSS_PAYLOADS) {
    it(`renders ${JSON.stringify(payload)} inert`, () => {
      const out = formatMessage(payload);
      expect(out).not.toMatch(/<script[\s>]/i);
      // Event handlers only matter inside a real (unescaped) tag.
      expect(out).not.toMatch(/<[^>]*\bon[a-z]+\s*=/i);
      expect(out).not.toMatch(/href\s*=\s*"\s*(javascript|data|vbscript):/i);
      // Nothing left that looks like a tag apart from the renderer's own.
      expect(out.replace(ALLOWED_TAGS, '')).not.toMatch(/[<>]/);
    });
  }

  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('renders unsafe link schemes as plain text', () => {
    expect(formatMessage('[x](javascript:alert(1))')).not.toContain('<a');
  });

  it('keeps quotes in URLs inside the attribute', () => {
    const out = formatMessage('[click](https://ok.example/"onmouseover="alert(1))');
    const a = /<a [^>]*>/.exec(out)?.[0] ?? '';
    expect(a).not.toMatch(/\sonmouseover=/i);
  });
});

describe('formatMessage markdown-lite', () => {
  const control = [
    '## Heading',
    '',
    '**bold** text and *italic* text',
    '',
    '- item one',
    '- item two',
    '',
    'See [SEPA](https://www.sepa.org.uk) for levels.',
  ].join('\n');
  const out = formatMessage(control);

  it('renders headings, emphasis, lists and links', () => {
    expect(out).toContain('<h2>Heading</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<ul><li>item one</li><li>item two</li></ul>');
    expect(out).toContain('<a href="https://www.sepa.org.uk" target="_blank" rel="noopener noreferrer">SEPA</a>');
  });

  it('supports ### headings and mailto links', () => {
    expect(formatMessage('### Small')).toBe('<h3>Small</h3>');
    expect(formatMessage('[mail](mailto:a@b.example)')).toContain('href="mailto:a@b.example"');
  });

  it('turns newlines into <br> but not after block elements', () => {
    expect(formatMessage('a\nb')).toBe('a<br>b');
    expect(formatMessage('## H\ntext')).toBe('<h2>H</h2>text');
  });

  it('does not italicise arithmetic', () => {
    expect(formatMessage('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('keeps ampersands in link URLs escaped', () => {
    expect(formatMessage('[q](https://x.example/?a=1&b=2)')).toContain('href="https://x.example/?a=1&amp;b=2"');
  });
});

describe('SseParser', () => {
  it('splits events across chunk boundaries', () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"te')).toEqual([]);
    expect(p.push('xt","text":"Hi"}\n\ndata: {"type":"done"}\n')).toEqual(['{"type":"text","text":"Hi"}']);
    expect(p.push('\n')).toEqual(['{"type":"done"}']);
  });

  it('handles CRLF and ignores comments', () => {
    const p = new SseParser();
    expect(p.push(': ping\r\n\r\ndata: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });
});

describe('list filters', () => {
  const s = (over: Partial<SectionSummary>): SectionSummary => ({
    slug: 'x',
    name: 'X',
    river: 'X',
    region: 'West Highlands',
    grade_text: '3',
    grade_min: 3,
    grade_max: 3,
    lat: null,
    lon: null,
    location_precision: null,
    status: 'unknown',
    status_basis: 'none',
    status_confidence: null,
    station_no: null,
    gauge_name: null,
    level: null,
    level_at: null,
    stale: false,
    trend: 'unknown',
    step: null,
    release_today: false,
    outlook: null,
    status_tomorrow: null,
    step_tomorrow: null,
    ...over,
  });
  const all = [
    s({ slug: 'etive', name: 'Etive (Upper)', river: 'River Etive', grade_min: 4, grade_max: 5, status: 'runnable' }),
    s({ slug: 'orchy', name: 'Orchy', river: 'River Orchy', grade_min: 3, grade_max: 4, status: 'low', region: 'Central Highlands' }),
    s({ slug: 'allt', name: "Allt a' Mhuilinn", river: 'Allt a’ Mhuilinn', grade_min: 2, grade_max: 2, status: 'runnable' }),
    s({ slug: 'nevis', name: 'Àbhainn Nibheis', river: 'Nevis', grade_min: null, grade_max: null }),
  ];

  it('matches search accent- and punctuation-insensitively', () => {
    expect(applyFilters(all, { ...DEFAULT_FILTERS, q: 'abhainn' }).shown.map((x) => x.slug)).toEqual(['nevis']);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, q: 'allt a mhuilinn' }).shown.map((x) => x.slug)).toEqual(['allt']);
    expect(normalize('Àbhainn’s')).toBe('abhainns');
  });

  it('filters by overlapping grade range and excludes ungraded sections', () => {
    const shown = applyFilters(all, { ...DEFAULT_FILTERS, gmin: 4, gmax: 6 }).shown.map((x) => x.slug);
    expect(shown.sort()).toEqual(['etive', 'orchy']);
  });

  it('sorts runnable first, then by name', () => {
    expect(applyFilters(all, DEFAULT_FILTERS).shown.map((x) => x.slug)).toEqual(['allt', 'etive', 'nevis', 'orchy']);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, sort: 'name' }).shown.map((x) => x.slug)).toEqual(['nevis', 'allt', 'etive', 'orchy']);
  });

  it('round-trips through the query string', () => {
    const f = { ...DEFAULT_FILTERS, q: 'etive', region: 'West Highlands', gmin: 3, status: 'runnable' as const };
    expect(filtersFromQuery(filtersToQuery(f))).toEqual(f);
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe('');
    expect(filtersFromQuery('?region=Nowhere&gmin=9').region).toBe('');
    expect(filtersFromQuery('?fav=1').fav).toBe(true);
    expect(filtersToQuery({ ...DEFAULT_FILTERS, fav: true })).toBe('?fav=1');
  });

  it('shows only favourites when asked', () => {
    const favs = new Set(['etive', 'orchy']);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, fav: true }, favs).shown.map((x) => x.slug)).toEqual(['etive', 'orchy']);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, fav: true }).shown).toEqual([]);
    expect(applyFilters(all, DEFAULT_FILTERS, favs).shown).toHaveLength(4);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  it('formats recent times', () => {
    expect(relativeTime('2026-10-06T11:48:00Z', now)).toBe('12 min ago');
    expect(relativeTime('2026-10-06T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime(null, now)).toBe('no reading');
  });
});
