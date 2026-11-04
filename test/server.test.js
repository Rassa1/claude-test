// Run: npm test   (node --test, no dependencies)
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.TZ = require('../config.json').timezone; // test clock in the school's timezone
let now = new Date(2026, 10, 4, 8, 0).getTime();
Date.now = () => now;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shuttle-test-'));
const app = require('../server.js');
const { config } = app;
const MIN = 60_000;
const S = Object.fromEntries(config.stops.map(s => [s.id, s]));
const at = id => ({ lat: S[id].lat, lng: S[id].lng });
const eta = id => app.buildState().stops.find(s => s.id === id).etas[0];
let ip = 0;
const report = (type, stop, device, extra = {}) => app.handleReport({ type, stop, bus: 'A', device, ...extra }, 'ip' + ip++);

test.beforeEach(() => { app.reset(); app.resetHistory(); now = new Date(2026, 10, 4, 8, 0).getTime(); });

test('arrival at a stop gives ETAs downstream from configured drive times', () => {
  report('arrive', 'main-gate', 'u1');
  assert.deepStrictEqual(eta('main-gate'), { bus: 'A', mins: 0, source: 'live' });
  assert.strictEqual(eta('library').mins, 1 + S.library.minsFromPrev);           // 1 min dwell + 4 min drive
  assert.strictEqual(eta('dorms').mins, 2 + S.library.minsFromPrev + S.dorms.minsFromPrev);
  now += 3 * MIN;
  assert.strictEqual(eta('library').mins, 2);
});

test('waiting count is per person and clears when the shuttle arrives', () => {
  report('wait', 'dorms', 'a'); report('wait', 'dorms', 'b'); report('wait', 'dorms', 'b');
  assert.strictEqual(app.buildState().stops.find(s => s.id === 'dorms').waiting, 2);
  now += MIN; report('arrive', 'dorms', 'c');
  assert.strictEqual(app.buildState().stops.find(s => s.id === 'dorms').waiting, 0);
});

test('duplicate taps are not double counted; floods are rate limited', () => {
  assert.strictEqual(report('arrive', 'library', 'x')[1], 'ok');
  assert.strictEqual(report('arrive', 'library', 'x')[1], 'already counted');
  let code;
  for (let i = 0; i < 50; i++) code = app.handleReport({ type: 'wait', stop: 'dorms', device: 'spam' + i }, 'same-ip')[0];
  assert.strictEqual(code, 429);
});

test('reports from far away or off the route are rejected', () => {
  assert.strictEqual(report('arrive', 'library', 'far', { lat: 40.2, lng: -75.3 })[0], 400);
  assert.strictEqual(report('gps', undefined, 'far', { lat: 41, lng: -75 })[0], 400);
  assert.strictEqual(report('arrive', 'nowhere', 'x')[0], 400);
});

test('an impossible lone report is ignored until a second person confirms it', () => {
  report('arrive', 'main-gate', 'u1');
  now += MIN;
  report('arrive', 'station', 'prank');           // station is ~25 min away
  assert.strictEqual(app.buildState().buses[0].pos.stop, 'main-gate');
  report('arrive', 'station', 'prank');           // same phone again doesn't count
  report('arrive', 'station', 'u2');              // a second real person does
  assert.strictEqual(app.buildState().buses[0].pos.stop, 'station');
});

test('live position goes stale after staleAfterMinutes', () => {
  report('arrive', 'library', 'u1');
  now += (config.staleAfterMinutes + 1) * MIN;
  assert.strictEqual(app.buildState().buses[0].pos, null);
  assert.strictEqual(eta('dorms'), undefined);
});

test('learns today\'s slower drive time from consecutive sightings', () => {
  const cfgEta = 1 + S.library.minsFromPrev;
  report('arrive', 'main-gate', 'u1');
  now += (1 + 2 * S.library.minsFromPrev) * MIN;  // traffic: Main Gate -> Library took twice as long
  report('arrive', 'library', 'u2');
  now += 25 * MIN;                                // next lap
  report('arrive', 'main-gate', 'u3');
  // learned time = average of config and today's sample -> 1.5x
  assert.strictEqual(eta('library').mins, Math.round(1 + 1.5 * S.library.minsFromPrev));
  assert.ok(eta('library').mins > cfgEta);
});

test('GPS between stops gives a partial-way ETA', () => {
  const A = at('main-gate'), B = at('library');
  report('gps', undefined, 'rider', { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 });
  assert.strictEqual(eta('library').mins, Math.round(S.library.minsFromPrev / 2));
});

test('with no live reports, ETAs come from past days ("usual time")', () => {
  for (let d = 5; d >= 1; d--) {                  // 5 past days: shuttle at Library at 8:10 every day
    app.reset();
    now = new Date(2026, 10, 4 - d, 8, 10).getTime();
    report('arrive', 'library', 'p' + d); report('arrive', 'library', 'q' + d);
    now += 5 * MIN; app.recordHistory();
  }
  app.reset();
  now = new Date(2026, 10, 4, 8, 0).getTime();
  const e = eta('library');
  assert.strictEqual(e.source, 'typical');
  assert.strictEqual(e.mins, 10);
  now = new Date(2026, 10, 4, 12, 0).getTime();   // never seen at noon -> no guess
  assert.strictEqual(eta('library'), undefined);
});

test('live reports win over history', () => {
  for (let d = 5; d >= 1; d--) {
    app.reset(); now = new Date(2026, 10, 4 - d, 8, 10).getTime();
    report('arrive', 'library', 'p' + d); report('arrive', 'library', 'q' + d);
    now += 5 * MIN; app.recordHistory();
  }
  app.reset(); now = new Date(2026, 10, 4, 8, 0).getTime();
  report('arrive', 'main-gate', 'u1');
  assert.strictEqual(eta('library').source, 'live');
});
