import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overpassQuery, parseOverpass, fetchOsmFeatures } from '../src/osm.js';

const sample = {
  elements: [
    { type: 'way', id: 1, center: { lat: 34.0577, lon: -117.8223 }, tags: { building: 'university', name: 'University Library', ref: '15' } },
    { type: 'way', id: 2, center: { lat: 34.0569, lon: -117.8213 }, tags: { building: 'yes', ref: '7' } },
    { type: 'way', id: 3, center: { lat: 34.0560, lon: -117.8190 }, tags: { amenity: 'parking', ref: 'F1' } },
    { type: 'way', id: 4, center: { lat: 34.0560, lon: -117.8190 }, tags: { building: 'yes', name: 'Building 98', ref: '98' } },
    { type: 'way', id: 5, tags: { building: 'yes', name: 'No position' } },
    { type: 'way', id: 1, center: { lat: 34.0577, lon: -117.8223 }, tags: { building: 'university', name: 'University Library', ref: '15' } },
  ],
};

test('parseOverpass builds labels, skips unusable entries and duplicates', () => {
  const f = parseOverpass(sample);
  assert.deepEqual(f.map(x => x.label), ['15 · University Library', 'Bldg 7', 'Building 98', 'Lot F1']);
  assert.deepEqual(f[0].pos, { lat: 34.0577, lng: -117.8223 });
  assert.equal(f[0].source, 'osm');
  assert.equal(f.at(-1).kind, 'parking');
});

test('query uses the play area (south, west, north, east)', () => {
  const q = overpassQuery({ sw: { lat: 1, lng: 2 }, ne: { lat: 3, lng: 4 } });
  assert.match(q, /\(1,2,3,4\)/);
});

test('fetchOsmFeatures falls back across endpoints and reports failure', async () => {
  let calls = 0;
  const ok = await fetchOsmFeatures({ sw: { lat: 1, lng: 2 }, ne: { lat: 3, lng: 4 } }, async () => {
    calls++;
    if (calls === 1) throw new Error('down');
    return { ok: true, json: async () => sample };
  });
  assert.equal(ok.length, 4);
  await assert.rejects(fetchOsmFeatures({ sw: { lat: 1, lng: 2 }, ne: { lat: 3, lng: 4 } }, async () => ({ ok: false, status: 504 })), /OpenStreetMap/);
});
