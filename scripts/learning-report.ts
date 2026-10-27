// How the level outlook is doing live: per gauge, checked days, live skill against
// "the peak stays at the level now", how often peaks landed in the likely range, and
// what the daily learning job (src/worker/learning.ts) has switched on.
//
// Usage: npm run data:learning            (production D1)
//        npm run data:learning -- --local (local dev D1)

import { execSync } from 'node:child_process';
import type { LearnedOutlook } from '../src/shared/learning.ts';

const where = process.argv.includes('--local') ? '--local' : '--remote';

function query<T>(sql: string): T[] {
  const out = execSync(`npx wrangler d1 execute riverguide ${where} --json --command "${sql.replace(/\s+/g, ' ')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return (JSON.parse(out) as Array<{ results: T[] }>)[0].results;
}

interface Row {
  station_no: string;
  name: string;
  learned: string | null;
  snapshots: number;
  checked: number;
  inside: number;
  mae: number | null;
  mae_persist: number | null;
  bias: number | null;
  rain_fc: number | null;
  rain_fell: number | null;
}

const rows = query<Row>(`
  SELECT s.station_no, g.name, g.learned, count(*) AS snapshots,
         sum(s.actual_t1 IS NOT NULL AND s.t1 IS NOT NULL) AS checked,
         sum(s.actual_t1 BETWEEN s.t1_lo AND s.t1_hi) AS inside,
         avg(abs(s.actual_t1 - s.t1)) AS mae,
         avg(CASE WHEN s.t1 IS NOT NULL THEN abs(s.actual_t1 - s.level_now) END) AS mae_persist,
         avg(s.actual_t1 - s.t1) AS bias,
         avg(CASE WHEN s.rain_fell_t1 IS NOT NULL THEN s.rain_tomorrow END) AS rain_fc,
         avg(s.rain_fell_t1) AS rain_fell
  FROM outlook_snapshots s JOIN gauges g USING (station_no)
  GROUP BY s.station_no ORDER BY checked DESC, g.name`);

const days = query<{ first: string | null; last: string | null; n: number }>('SELECT min(issued_day) AS first, max(issued_day) AS last, count(DISTINCT issued_day) AS n FROM outlook_snapshots')[0];
console.log(`Snapshots: ${days.n} days (${days.first ?? '-'} to ${days.last ?? '-'}), ${rows.length} gauges.\n`);

const f = (v: number | null | undefined, d = 3) => (v == null ? '-' : v.toFixed(d));
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const table = rows
  .filter((r) => r.checked > 0)
  .map((r) => {
    const l = r.learned ? (JSON.parse(r.learned) as LearnedOutlook) : null;
    const on = l ? [l.tomorrow.bias ? `bias ${l.tomorrow.bias > 0 ? '+' : ''}${l.tomorrow.bias}` : '', l.tomorrow.scale !== 1 ? `range x${l.tomorrow.scale}` : '', l.demoted ? 'DIRECTION ONLY' : ''].filter(Boolean).join(', ') : '';
    return {
      gauge: `${r.name} (${r.station_no})`.slice(0, 34),
      checked: r.checked,
      'raw skill': r.mae != null && r.mae_persist ? f(1 - r.mae / r.mae_persist, 2) : '-',
      'learned skill': f(l?.skill, 2),
      'in range': pct(r.inside, r.checked),
      'mean miss m': f(r.bias),
      'rain fc/fell mm': r.rain_fell == null ? '-' : `${f(r.rain_fc, 1)}/${f(r.rain_fell, 1)}`,
      corrections: on || '-',
    };
  });
if (table.length) console.table(table);
else console.log('Nothing checked yet: SEPA publishes daily peaks a day or two later, and corrections need 30 checked days per gauge.');
console.log('\nraw skill: 1 - (model error / error of "the peak stays at the level now"), tomorrow, before corrections. In range: the 80% range should hold about 80%.');
