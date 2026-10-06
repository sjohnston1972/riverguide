// Snapshot of SEPA's level-gauge network -> data/gauges.json.
// SEPA data is published under the Open Government Licence; this file is safe to commit.
// The Worker refreshes the same metadata daily, so this is only the seed.

import { writeFileSync } from 'node:fs';
import { fetchLevelStations } from '../src/shared/sepa.ts';

const stations = await fetchLevelStations();
stations.sort((a, b) => a.station_no.localeCompare(b.station_no));
writeFileSync('data/gauges.json', JSON.stringify(stations, null, 1) + '\n');
console.log(`Wrote ${stations.length} gauges (${stations.filter((s) => s.typical_low != null).length} with typical range)`);
