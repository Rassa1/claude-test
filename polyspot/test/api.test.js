import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { localDate } from '../src/store.js';

let server, base, dataDir;
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
};
// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyspot-test-'));
  server = http.createServer(createApp({ dataDir }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('first run seeds a map and a sample round dated today, without leaking the answer', async () => {
  const maps = (await call('GET', '/api/maps')).body;
  assert.equal(maps[0].id, 'dorm');
  const { body } = await call('GET', `/api/rounds/today?date=${localDate()}`);
  assert.equal(body.round.id, 'sample');
  assert.equal(body.round.truth, undefined);
  const photo = await fetch(base + body.round.photoUrl);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('GET', '/api/rounds/sample/guesses')).body.truth, null);
});

test('guessing scores, reveals the truth and keeps history', async () => {
  const r1 = await call('POST', '/api/rounds/sample/guesses', { pos: { x: 0.9144, y: 3.9624 }, heading: 20 });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.guess.total, 10000);
  assert.deepEqual(r1.body.truth, { pos: { x: 0.9144, y: 3.9624 }, heading: 20 });
  const r2 = await call('POST', '/api/rounds/sample/guesses', { pos: { x: 3, y: 1 }, heading: 200 });
  assert.equal(r2.body.guess.angleError, 180);
  assert.equal(r2.body.guess.direction, 0);
  const hist = (await call('GET', '/api/rounds/sample/guesses')).body;
  assert.equal(hist.guesses.length, 2);
  assert.ok(hist.truth);
  const list = (await call('GET', '/api/rounds')).body;
  assert.equal(list.find(r => r.id === 'sample').best, 10000);
});

test('host creates a round; bad input is rejected', async () => {
  const ok = await call('POST', '/api/rounds', { mapId: 'dorm', photo: PNG, truth: { pos: { x: 1, y: 1 }, heading: 370 }, difficulty: 'night', date: '2030-01-02', title: 'Night desk' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.date, '2030-01-02');
  assert.equal((await call('GET', `/api/rounds/today?date=2030-01-02`)).body.round.id, ok.body.id);
  const g = await call('POST', `/api/rounds/${ok.body.id}/guesses`, { pos: { x: 1, y: 1 }, heading: 10 });
  assert.equal(g.body.guess.total, 15000, 'heading 370 is stored as 10°, night multiplier ×1.5');

  assert.equal((await call('POST', '/api/rounds', { mapId: 'dorm', photo: 'data:image/png;base64,AAAA', truth: { pos: { x: 1, y: 1 }, heading: 0 }, difficulty: 'easy' })).status, 400);
  assert.equal((await call('POST', '/api/rounds', { mapId: 'dorm', photo: PNG, truth: { heading: 0 }, difficulty: 'easy' })).status, 400);
  assert.equal((await call('POST', '/api/rounds', { mapId: 'dorm', photo: PNG, truth: { pos: { x: 1, y: 1 }, heading: 0 }, difficulty: 'nope' })).status, 400);

  assert.equal((await call('DELETE', `/api/rounds/${ok.body.id}`)).status, 200);
  assert.equal((await call('GET', `/api/rounds/${ok.body.id}`)).status, 404);
});

test('maps can be created and edited; features are clamped inside', async () => {
  const created = await call('POST', '/api/maps', { name: 'Lab', units: 'm', width: 10, length: 6, features: [{ label: 'Door', pos: { x: 50, y: 2 } }] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.features[0].pos, { x: 10, y: 2 });
  const edited = await call('PUT', `/api/maps/${created.body.id}`, { ...created.body, width: 12, topBearing: 450 });
  assert.equal(edited.body.width, 12);
  assert.equal(edited.body.topBearing, 90);
  assert.equal((await call('POST', '/api/maps', { width: 0, length: 3 })).status, 400);
});

test('static files and path traversal', async () => {
  assert.match((await call('GET', '/')).body, /PolySpot/);
  assert.equal((await call('GET', '/shared/scoring.config.js')).status, 200);
  assert.equal((await call('GET', '/../src/app.js')).status, 404);
  assert.equal((await call('GET', '/photos/..%2Fdb.json')).status, 404);
});
