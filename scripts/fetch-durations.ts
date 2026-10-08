// Level-duration curves for every SEPA level gauge -> data/gauge-durations.json.
// Built from three years of daily maximum levels (SEPA, Open Government Licence).
// Re-run occasionally (e.g. yearly); the Worker does not refresh these.

import { writeFileSync } from 'node:fs';
import { buildCurve, type DurationCurve } from '../src/shared/duration.ts';
import { fetchSeriesValues, parseTable, KIWIS } from '../src/shared/sepa.ts';

const PERIOD = 'P3Y';
const BATCH = 25;

const list = parseTable(
  await (await fetch(`${KIWIS}&request=getTimeseriesList&stationparameter_name=Level&ts_name=Day.Max&returnfields=station_no,ts_id&format=json`)).json(),
);
const stationByTs = new Map(list.map((r) => [r.ts_id, r.station_no]));
const ids = [...stationByTs.keys()];

const curves: Record<string, { days: number; curve: DurationCurve } | null> = {};
for (let i = 0; i < ids.length; i += BATCH) {
  const series = await fetchSeriesValues(ids.slice(i, i + BATCH), PERIOD);
  for (const s of series) {
    const station = stationByTs.get(s.ts_id);
    if (!station) continue;
    const values = s.points.map(([, v]) => v);
    const curve = buildCurve(values);
    curves[station] = curve ? { days: values.length, curve } : null;
  }
  process.stdout.write(`\r${Math.min(i + BATCH, ids.length)}/${ids.length}`);
}

const usable = Object.values(curves).filter(Boolean).length;
writeFileSync(
  'data/gauge-durations.json',
  JSON.stringify({ source: 'SEPA Day.Max level', period: PERIOD, built: new Date().toISOString().slice(0, 10), curves }, null, 1) + '\n',
);
console.log(`\nWrote curves for ${usable}/${ids.length} gauges`);
