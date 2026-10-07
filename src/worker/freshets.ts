// Daily refresh of hydro dam releases from SEPA's published freshet schedule.

import { freshetRows, loadFreshetSchedules } from '../shared/freshets.ts';
import { readOds } from '../shared/ods.ts';

/** Replaces stored releases for the years SEPA currently publishes. Keeps what's stored if anything fails. */
export async function refreshFreshets(db: D1Database): Promise<number> {
  const { years, releases } = await loadFreshetSchedules(readOds);
  const rows = freshetRows(releases);
  const yearClause = years.map(() => 'substr(start, 1, 4) = ?').join(' OR ');
  await db.batch([
    db.prepare(`DELETE FROM freshets WHERE ${yearClause}`).bind(...years.map(String)),
    ...rows.map((r) =>
      db
        .prepare('INSERT OR REPLACE INTO freshets (source, location, start, end, volume_m3, hours) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(r.source, r.location, r.start, r.end, r.volume_m3, r.hours),
    ),
  ]);
  return rows.length;
}
