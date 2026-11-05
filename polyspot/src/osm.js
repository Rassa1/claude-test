// Building and landmark names from OpenStreetMap (Overpass API), used as labels on a campus map.
// Runs on the laptop's server, so it needs internet once; the labels are then stored in data/db.json.
const ENDPOINTS = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const MAX_FEATURES = 300;

export function overpassQuery({ sw, ne }) {
  const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
  return `[out:json][timeout:30];
(
  nwr["building"]["name"](${bbox});
  nwr["building"]["ref"](${bbox});
  nwr["amenity"="parking"]["name"](${bbox});
  nwr["amenity"="parking"]["ref"](${bbox});
  nwr["amenity"="library"]["name"](${bbox});
  nwr["leisure"~"^(stadium|sports_centre|track|park|garden)$"]["name"](${bbox});
);
out center tags;`;
}

function labelFor(t) {
  const name = (t['name:en'] || t.name || '').trim();
  const ref = (t.ref || '').trim();
  if (name && ref && !name.includes(ref)) return `${ref} · ${name}`;
  if (name) return name;
  if (ref) return t.building ? `Bldg ${ref}` : t.amenity === 'parking' ? `Lot ${ref}` : ref;
  return '';
}

const kindFor = t => (t.amenity === 'parking' ? 'parking' : t.building ? 'building' : 'place');

/** Overpass JSON → [{ id, label, kind, source: 'osm', pos: { lat, lng } }] */
export function parseOverpass(json) {
  const seen = new Set();
  const out = [];
  for (const el of json?.elements || []) {
    const t = el.tags || {};
    const lat = el.center?.lat ?? el.lat, lng = el.center?.lon ?? el.lon;
    const label = labelFor(t).slice(0, 60);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${label}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `osm-${el.type[0]}${el.id}`, label, kind: kindFor(t), source: 'osm', pos: { lat, lng } });
  }
  // buildings first, so they survive the cap
  const order = { building: 0, place: 1, parking: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, MAX_FEATURES);
}

export async function fetchOsmFeatures(bounds, fetchImpl = fetch) {
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PolySpot/0.1 (local campus photo game)' },
        body: new URLSearchParams({ data: overpassQuery(bounds) }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return parseOverpass(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not reach OpenStreetMap (${lastError?.message || 'no response'})`);
}
