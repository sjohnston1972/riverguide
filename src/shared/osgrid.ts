// Ordnance Survey grid references -> WGS84 latitude/longitude.
//
// Pipeline: grid letters + digits -> OSGB36 easting/northing -> OSGB36
// lat/lon (inverse Transverse Mercator on the Airy 1830 ellipsoid) -> WGS84
// via a 7-parameter Helmert transform. Accurate to roughly 5 m, which is far
// better than a put-in description needs.

export interface LatLon {
  lat: number;
  lon: number;
}

const GRID_REF_RE = /\b([HNOST][A-HJ-Z])\s?(\d{2,5})\s?(\d{2,5})\b/g;

/** Every well-formed grid reference in a block of text, normalised (e.g. "NN2367755387"). */
export function findGridRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(GRID_REF_RE)) {
    if (m[2].length !== m[3].length) continue;
    out.push(`${m[1]}${m[2]}${m[3]}`);
  }
  return out;
}

/** Grid reference -> OSGB36 easting/northing (centre of the referenced square). */
export function gridRefToEastingNorthing(ref: string): { e: number; n: number } | null {
  const clean = ref.replace(/\s+/g, '').toUpperCase();
  const m = /^([A-HJ-Z])([A-HJ-Z])(\d+)$/.exec(clean);
  if (!m || m[3].length % 2 !== 0 || m[3].length < 4 || m[3].length > 10) return null;

  let l1 = m[1].charCodeAt(0) - 65;
  let l2 = m[2].charCodeAt(0) - 65;
  if (l1 > 7) l1--; // the grid alphabet skips I
  if (l2 > 7) l2--;
  const e100km = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100km = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  if (e100km < 0 || e100km > 6 || n100km < 0 || n100km > 12) return null;

  const half = m[3].length / 2;
  const scale = 10 ** (5 - half);
  const e = parseInt(m[3].slice(0, half), 10) * scale + scale / 2;
  const n = parseInt(m[3].slice(half), 10) * scale + scale / 2;
  return { e: e100km * 100000 + e, n: n100km * 100000 + n };
}

const AIRY = { a: 6377563.396, b: 6356256.909 };
const WGS84 = { a: 6378137, b: 6356752.314245 };
const F0 = 0.9996012717;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const N0 = -100000;
const E0 = 400000;

function eastingNorthingToOsgb36(E: number, N: number): { lat: number; lon: number } {
  const { a, b } = AIRY;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  let lat = LAT0;
  let M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - LAT0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - LAT0) * Math.cos(lat + LAT0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - LAT0)) * Math.cos(2 * (lat + LAT0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - LAT0)) * Math.cos(3 * (lat + LAT0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001);

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat);
  const tan2 = tanLat * tanLat;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const secLat = 1 / cosLat;
  const nu3 = nu * nu * nu;
  const nu5 = nu3 * nu * nu;
  const nu7 = nu5 * nu * nu;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const dE = E - E0;
  return {
    lat: lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6,
    lon: LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7,
  };
}

function osgb36ToWgs84(latR: number, lonR: number): LatLon {
  // Cartesian on Airy 1830
  const { a, b } = AIRY;
  const e2 = 1 - (b * b) / (a * a);
  const sinLat = Math.sin(latR);
  const cosLat = Math.cos(latR);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const x1 = nu * cosLat * Math.cos(lonR);
  const y1 = nu * cosLat * Math.sin(lonR);
  const z1 = (1 - e2) * nu * sinLat;

  // Helmert OSGB36 -> WGS84 (the published WGS84 -> OSGB36 parameters, negated)
  const tx = 446.448;
  const ty = -125.157;
  const tz = 542.06;
  const s = 20.4894 / 1e6;
  const sec = Math.PI / (180 * 3600);
  const rx = 0.1502 * sec;
  const ry = 0.247 * sec;
  const rz = 0.8421 * sec;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;

  // Back to lat/lon on WGS84
  const wa = WGS84.a;
  const wb = WGS84.b;
  const we2 = 1 - (wb * wb) / (wa * wa);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let lat = Math.atan2(z2, p * (1 - we2));
  let prev = 2 * Math.PI;
  while (Math.abs(lat - prev) > 1e-12) {
    const nu2 = wa / Math.sqrt(1 - we2 * Math.sin(lat) ** 2);
    prev = lat;
    lat = Math.atan2(z2 + we2 * nu2 * Math.sin(lat), p);
  }
  const lon = Math.atan2(y2, x2);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Grid reference -> WGS84 lat/lon rounded to 5 dp, or null if malformed. */
export function gridRefToLatLon(ref: string): LatLon | null {
  const en = gridRefToEastingNorthing(ref);
  if (!en) return null;
  const osgb = eastingNorthingToOsgb36(en.e, en.n);
  const w = osgb36ToWgs84(osgb.lat, osgb.lon);
  return { lat: Math.round(w.lat * 1e5) / 1e5, lon: Math.round(w.lon * 1e5) / 1e5 };
}
