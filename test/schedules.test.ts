import { describe, expect, it } from 'vitest';
import { cumecs, freshetRows, freshetSourceFor, parseFreshetSchedule, scheduleLinks, sourceKey, ukLocalNow } from '../src/shared/freshets.ts';
import { parseOdsContent, readOds } from '../src/shared/ods.ts';
import { LORA, loraEbbs, nodal, predict, predictor, sunAltitude, type TideModel, turningPoints } from '../src/shared/tides.ts';

const cell = (text: string) => `<table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell>`;
const dateCell = (iso: string, text: string) => `<table:table-cell office:value-type="date" office:date-value="${iso}"><text:p>${text}</text:p></table:table-cell>`;
const num = (v: number) => `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v.toLocaleString('en-US')}</text:p></table:table-cell>`;
const row = (...cells: string[]) => `<table:table-row>${cells.join('')}<table:table-cell table:number-columns-repeated="16376"/></table:table-row>`;

const CONTENT = `<?xml version="1.0"?><office:document-content><office:body><office:spreadsheet>
<table:table table:name="Information">${row(cell('SSE Freshet Release Schedule 2026'))}</table:table>
<table:table table:name="Release_Frequency">
${row(cell('Authorisation'), cell('Location Description'), cell('Release Start Date'), cell('Release Start Time'), cell('Release End Date'), cell('Release End Time'), cell('Freshet Volume (m3)'), cell('Freshet Duration (hrs)'))}
${row(cell('CAR/L/1'), cell('Garry (Invergarry)'), dateCell('2026-07-02T08:00:00', 'Thursday, July 02, 2026'), cell('8:00:00 AM'), dateCell('2026-07-03T04:00:00', 'Friday, July 03, 2026'), cell('4:00:00 AM'), num(684225), num(20))}
${row(cell('CAR/L/2'), cell('Meig - River Meig'), dateCell('2026-06-04', 'Thursday, June 04, 2026'), cell('9:00:00 AM'), dateCell('2026-06-05', 'Friday, June 05, 2026'), cell('9:00:00 AM'), num(36000), num(24))}
${row(cell('CAR/L/3'), cell('Kingairloch - Loch Uisge Dam'), cell('No set date. Three freshets per month'), cell('10:00:00 AM'), cell('No set date'), cell(''), num(4320), num(10))}
${row(cell('CAR/L/4'), cell('New &amp; Unknown<text:s/>Dam'), dateCell('2026-08-01T13:00:00', 'Saturday, August 01, 2026'), cell('1:00:00 PM'), dateCell('2026-08-01T19:00:00', 'Saturday, August 01, 2026'), cell('7:00:00 PM'), num(21600), num(6))}
<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`;

/** A zip with one stored (uncompressed) entry. */
function storedZip(name: string, text: string): ArrayBuffer {
  const enc = new TextEncoder();
  const n = enc.encode(name);
  const d = enc.encode(text);
  const local = new Uint8Array(30 + n.length + d.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, d.length, true);
  lv.setUint32(22, d.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  local.set(d, 30 + n.length);
  const central = new Uint8Array(46 + n.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(20, d.length, true);
  cv.setUint32(24, d.length, true);
  cv.setUint16(28, n.length, true);
  central.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out.buffer;
}

describe('ods reader', () => {
  it('reads sheets, decodes entities and spaces, and ignores padding', () => {
    const sheets = parseOdsContent(CONTENT);
    expect([...sheets.keys()]).toEqual(['Information', 'Release_Frequency']);
    const rows = sheets.get('Release_Frequency')!;
    expect(rows).toHaveLength(5);
    expect(rows[4][1].text).toBe('New & Unknown Dam');
    expect(rows[1][2].value).toBe('2026-07-02T08:00:00');
  });

  it('unzips content.xml', async () => {
    const sheets = await readOds(storedZip('content.xml', CONTENT));
    expect(sheets.get('Information')![0][0].text).toBe('SSE Freshet Release Schedule 2026');
  });
});

describe('freshet schedule', () => {
  const releases = parseFreshetSchedule(parseOdsContent(CONTENT));

  it('parses dated releases with local start and end times, skipping undated ones', () => {
    expect(releases).toEqual([
      { location: 'Garry (Invergarry)', start: '2026-07-02T08:00', end: '2026-07-03T04:00', volume_m3: 684225, hours: 20 },
      { location: 'Meig - River Meig', start: '2026-06-04T09:00', end: '2026-06-05T09:00', volume_m3: 36000, hours: 24 },
      { location: 'New & Unknown Dam', start: '2026-08-01T13:00', end: '2026-08-01T19:00', volume_m3: 21600, hours: 6 },
    ]);
  });

  it('keys releases by source and keeps unknown locations', () => {
    expect(freshetRows(releases).map((r) => r.source)).toEqual(['garry', 'meig', 'new-unknown-dam']);
    expect(sourceKey('Stronuich – River Lyon')).toBe('lyon');
    expect(sourceKey('Dundreggan (River Moriston)')).toBe('moriston');
    expect(sourceKey('Cluanie - River Moriston')).toBe('moriston-cluanie');
    expect(freshetSourceFor('river-lyon')?.note).toMatch(/Stronuich/);
    expect(freshetSourceFor('river-tay')).toBeNull();
  });

  it('works out average flow', () => {
    expect(cumecs(684225, 20)).toBeCloseTo(9.5, 2);
    expect(cumecs(1, 0)).toBe(0);
  });

  it('finds schedule links on the SEPA page, newest first', () => {
    const html = '<a href="/media/aa/sse-freshet-schedule-2025.ods">2025</a> <a href="/media/bb/sse-freshet-schedule-2026.ods">2026</a>';
    expect(scheduleLinks(html, 'https://beta.sepa.scot/topics/x/')).toEqual([
      { year: 2026, url: 'https://beta.sepa.scot/media/bb/sse-freshet-schedule-2026.ods' },
      { year: 2025, url: 'https://beta.sepa.scot/media/aa/sse-freshet-schedule-2025.ods' },
    ]);
  });

  it('formats UK local time in summer and winter', () => {
    expect(ukLocalNow(new Date('2026-07-02T07:30:00Z'))).toBe('2026-07-02T08:30');
    expect(ukLocalNow(new Date('2026-12-02T07:30:00Z'))).toBe('2026-12-02T07:30');
  });
});

describe('tides', () => {
  // A pure semi-diurnal tide: M2 only, 1.8 m amplitude (3.6 m range), mean 2.4 m.
  const model: TideModel = {
    station: 'test',
    epoch: '2026-01-01T00:00:00.000Z',
    z0: 2.4,
    names: ['M2'],
    amp: [1.8],
    phase: [0],
    fitted: { from: '', to: '', rms_m: 0 },
  };

  // The 18.6-year nodal cycle scales M2 by a few percent.
  const f2026 = nodal('M2', Date.parse('2026-06-01T00:00:00Z')).f;

  it('fast predictor matches the direct prediction', () => {
    const t = Date.parse('2026-06-01T10:00:00Z');
    expect(predictor(model, t)(t)).toBeCloseTo(predict(model, t), 9);
  });

  it('finds high and low waters half an M2 period apart', () => {
    const from = Date.parse('2026-06-01T00:00:00Z');
    const turns = turningPoints(model, from, from + 2 * 86_400_000);
    const highs = turns.filter((x) => x.kind === 'high');
    expect(highs.length).toBeGreaterThanOrEqual(3);
    expect((highs[1].t - highs[0].t) / 3_600_000).toBeCloseTo(12.42, 1);
    const lowAfter = turns.find((x) => x.kind === 'low' && x.t > highs[0].t)!;
    expect((lowAfter.t - highs[0].t) / 3_600_000).toBeCloseTo(6.21, 1);
    expect(highs[0].height - lowAfter.height).toBeCloseTo(3.6 * f2026, 2);
  });

  it('times Falls of Lora ebbs from Oban high and low water', () => {
    const from = Date.parse('2026-06-01T00:00:00Z');
    const ebbs = loraEbbs(model, from, from + 86_400_000);
    expect(ebbs.length).toBeGreaterThan(0);
    const e = ebbs[0];
    expect((Date.parse(e.ebb_start) - Date.parse(e.high_water)) / 60_000).toBeCloseTo(LORA.ebbStartAfterHighMin, 0);
    expect((Date.parse(e.main_wave) - Date.parse(e.ebb_start)) / 60_000).toBeCloseTo(LORA.mainWaveAfterEbbStartMin, 0);
    expect((Date.parse(e.ebb_end) - Date.parse(e.low_water)) / 60_000).toBeCloseTo(LORA.ebbEndAfterLowMin, 0);
    expect(e.range_m).toBeCloseTo(3.6 * f2026 * LORA.tableScale, 1);
    expect(e.size).toBe('big');
  });

  it('drops tides below the working range', () => {
    const small = { ...model, amp: [1.3] }; // 2.6 m range, 2.8 m on the table scale
    expect(loraEbbs(small, Date.parse('2026-06-01T00:00:00Z'), Date.parse('2026-06-03T00:00:00Z'))).toEqual([]);
  });

  it('knows day from night at Connel', () => {
    expect(sunAltitude(Date.parse('2026-06-21T12:30:00Z'), 56.45, -5.39)).toBeGreaterThan(50);
    expect(sunAltitude(Date.parse('2026-12-21T00:00:00Z'), 56.45, -5.39)).toBeLessThan(-30);
  });
});
