import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleError, bearing, clampPos, distance, mapSpan, norm360 } from '../shared/geo.js';

const room = { type: 'floorplan', width: 4, length: 3 };
const campus = { type: 'latlng', bounds: { sw: { lat: 34.05, lng: -117.83 }, ne: { lat: 34.065, lng: -117.81 } } };

test('angleError is the shortest difference, 0–180', () => {
  assert.equal(angleError(10, 350), 20);
  assert.equal(angleError(350, 10), 20);
  assert.equal(angleError(0, 180), 180);
  assert.equal(angleError(90, 90), 0);
  assert.equal(angleError(-90, 270), 0);
  assert.equal(norm360(-30), 330);
});

test('floorplan: distance, span, bearing (0° = up, clockwise), clamp', () => {
  assert.equal(distance(room, { x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(mapSpan(room), 5);
  const c = { x: 2, y: 1.5 };
  assert.equal(bearing(room, c, { x: 2, y: 0 }), 0);
  assert.equal(bearing(room, c, { x: 4, y: 1.5 }), 90);
  assert.equal(bearing(room, c, { x: 2, y: 3 }), 180);
  assert.equal(bearing(room, c, { x: 0, y: 1.5 }), 270);
  assert.deepEqual(clampPos(room, { x: -1, y: 9 }), { x: 0, y: 3 });
});

test('latlng: haversine distance and compass bearing (ready for a real campus map)', () => {
  const a = { lat: 34.058, lng: -117.82 };
  const d = distance(campus, a, { lat: 34.059, lng: -117.82 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `0.001° of latitude ≈ 111 m, got ${d}`);
  assert.ok(bearing(campus, a, { lat: 34.059, lng: -117.82 }) < 0.01);
  assert.ok(Math.abs(bearing(campus, a, { lat: 34.058, lng: -117.819 }) - 90) < 0.1);
  assert.ok(mapSpan(campus) > 2000 && mapSpan(campus) < 2500);
});
