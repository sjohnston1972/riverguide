import type { LatLon } from './osgrid.ts';

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough bounding box for Scotland, used to reject bad geocodes. */
export function inScotland(p: LatLon): boolean {
  return p.lat > 54.6 && p.lat < 60.9 && p.lon > -8.7 && p.lon < -0.7;
}
