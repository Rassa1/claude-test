// Coordinate systems. Game logic (scoring, validation) only calls the functions exported here and never
// reads x/y or lat/lng itself, so a new kind of map just needs an entry in `systems` plus a map adapter
// in public/js/map/. Shared by the server and the browser.
//
//   floorplan: { x, y } in meters from the top-left corner, x → right, y → down.
//              Heading 0° = toward the top of the map, clockwise.
//   latlng:    { lat, lng } in degrees (for a real campus map, e.g. Leaflet). Heading 0° = true north.

const EARTH_RADIUS_M = 6371008.8;
const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Normalize any angle to [0, 360). */
export const norm360 = d => ((d % 360) + 360) % 360;

/** Shortest angular difference between two headings, 0–180°. */
export function angleError(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

function haversine(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), dφ = φ2 - φ1, dλ = toRad(b.lng - a.lng);
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

const systems = {
  floorplan: {
    isPos: p => Number.isFinite(p?.x) && Number.isFinite(p?.y),
    distance: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
    bearing: (a, b) => norm360(toDeg(Math.atan2(b.x - a.x, -(b.y - a.y)))),
    span: map => Math.hypot(map.width, map.length),
    clamp: (map, p) => ({ x: clamp(p.x, 0, map.width), y: clamp(p.y, 0, map.length) }),
  },
  latlng: {
    isPos: p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
    distance: haversine,
    bearing: (a, b) => {
      const φ1 = toRad(a.lat), φ2 = toRad(b.lat), dλ = toRad(b.lng - a.lng);
      const y = Math.sin(dλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
      return norm360(toDeg(Math.atan2(y, x)));
    },
    // map.bounds = { sw: { lat, lng }, ne: { lat, lng } }
    span: map => haversine(map.bounds.sw, map.bounds.ne),
    clamp: (map, p) => ({
      lat: clamp(p.lat, map.bounds.sw.lat, map.bounds.ne.lat),
      lng: clamp(p.lng, map.bounds.sw.lng, map.bounds.ne.lng),
    }),
  },
};

function sys(map) {
  const s = systems[map?.type];
  if (!s) throw new Error(`Unknown map type: ${map?.type}`);
  return s;
}

export const mapTypes = Object.keys(systems);
/** True if `p` is a well-formed position for this map (it may still be outside the map). */
export const isValidPos = (map, p) => sys(map).isPos(p);
/** Distance between two positions, in meters. */
export const distance = (map, a, b) => sys(map).distance(a, b);
/** Heading from `a` toward `b`, 0–360°. */
export const bearing = (map, a, b) => sys(map).bearing(a, b);
/** Size of the map (its diagonal), in meters. Used to scale position scoring. */
export const mapSpan = map => sys(map).span(map);
/** Pull a position back inside the map's bounds. */
export const clampPos = (map, p) => sys(map).clamp(map, p);
