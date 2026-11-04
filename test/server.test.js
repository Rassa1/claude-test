// Run: npm test   (node --test, no dependencies)
const test = require('node:test');
const assert = require('node:assert');
const base = require('../config.json');
process.env.TZ = base.timezone; // test clocks in the school's timezone
const { createTracker } = require('../core.js');

const MIN = 60_000;
const day = (h, m, d = 4) => new Date(2026, 10, d, h, m).getTime(); // Wed 4 Nov 2026
const noSchedule = { ...base, shuttles: [{ id: 'A', name: 'Shuttle A' }] };
const S = Object.fromEntries(base.stops.map(s => [s.id, s]));

function setup(config = noSchedule, t = day(8, 0)) {
  const clock = { t };
  const tr = createTracker(config, { now: () => clock.t });
  let ip = 0;
  const report = (type, stop, device, extra = {}) => tr.handleReport({ type, stop, bus: 'A', device, ...extra }, 'ip' + ip++);
  const eta = id => tr.buildState().stops.find(s => s.id === id).etas[0];
  const bus = (id = 'A') => tr.buildState().buses.find(b => b.id === id);
  return { clock, tr, report, eta, bus, wait: m => { clock.t += m * MIN; } };
}

test('arrival at a stop gives ETAs downstream from configured drive times', () => {
  const { report, eta, wait } = setup();
  report('arrive', 'main-gate', 'u1');
  assert.strictEqual(eta('main-gate').mins, 0);
  assert.strictEqual(eta('library').mins, 1 + S.library.minsFromPrev);            // 1 min stop + 4 min drive
  assert.strictEqual(eta('dorms').mins, 2 + S.library.minsFromPrev + S.dorms.minsFromPrev);
  wait(3);
  assert.strictEqual(eta('library').mins, 2);
});

test('waiting count is per person and clears when the shuttle arrives', () => {
  const { tr, report, wait } = setup();
  report('wait', 'dorms', 'a'); report('wait', 'dorms', 'b'); report('wait', 'dorms', 'b');
  assert.strictEqual(tr.buildState().stops.find(s => s.id === 'dorms').waiting, 2);
  wait(1); report('arrive', 'dorms', 'c');
  assert.strictEqual(tr.buildState().stops.find(s => s.id === 'dorms').waiting, 0);
});

test('duplicate taps are not double counted; floods are rate limited', () => {
  const { tr, report } = setup();
  assert.strictEqual(report('arrive', 'library', 'x')[1], 'ok');
  assert.strictEqual(report('arrive', 'library', 'x')[1], 'already counted');
  let code;
  for (let i = 0; i < 50; i++) code = tr.handleReport({ type: 'wait', stop: 'dorms', device: 'spam' + i }, 'same-ip')[0];
  assert.strictEqual(code, 429);
});

test('reports from far away or off the route are rejected', () => {
  const { report } = setup();
  assert.strictEqual(report('arrive', 'library', 'far', { lat: 40.2, lng: -75.3 })[0], 400);
  assert.strictEqual(report('gps', undefined, 'far', { lat: 41, lng: -75 })[0], 400);
  assert.strictEqual(report('arrive', 'nowhere', 'x')[0], 400);
});

test('an impossible lone report is ignored until a second person confirms it', () => {
  const { report, bus, wait } = setup();
  report('arrive', 'main-gate', 'u1');
  wait(1);
  report('arrive', 'station', 'prank');          // the station is ~25 min away
  assert.strictEqual(bus().pos.stop, 'main-gate');
  report('arrive', 'station', 'prank');          // the same phone again doesn't count
  report('arrive', 'station', 'u2');             // a second real person does
  assert.strictEqual(bus().pos.stop, 'station');
});

test('live position goes stale after staleAfterMinutes', () => {
  const { report, bus, eta, wait } = setup();
  report('arrive', 'library', 'u1');
  wait(base.staleAfterMinutes + 1);
  assert.strictEqual(bus().pos, null);
  assert.strictEqual(eta('dorms'), undefined);
});

test("learns today's slower drive time from consecutive sightings", () => {
  const { report, eta, wait } = setup();
  report('arrive', 'main-gate', 'u1');
  wait(1 + 2 * S.library.minsFromPrev);          // traffic: Main Gate -> Library took twice as long
  report('arrive', 'library', 'u2');
  wait(25);                                       // next lap
  report('arrive', 'main-gate', 'u3');
  assert.strictEqual(eta('library').mins, Math.round(1 + 1.5 * S.library.minsFromPrev)); // average of usual and today
});

test('GPS between stops gives a partway ETA and a map position', () => {
  const { report, eta, bus } = setup();
  const A = S['main-gate'], B = S.library;
  report('gps', undefined, 'rider', { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 });
  assert.strictEqual(eta('library').mins, Math.round(S.library.minsFromPrev / 2));
  const est = bus().est;
  assert.strictEqual(est.to, 'library');
  assert.ok(Math.abs(est.lat - (A.lat + B.lat) / 2) < 0.0003);
});

test('with no live reports, ETAs come from past days ("usual time"); live reports win', () => {
  const { clock, tr, report, eta } = setup();
  for (let d = 5; d >= 1; d--) {                  // 5 past days: shuttle at the Library at 8:10
    tr.reset(); clock.t = day(8, 10, 4 - d);
    report('arrive', 'library', 'p' + d); report('arrive', 'library', 'q' + d);
    clock.t += 5 * MIN; tr.recordHistory();
  }
  tr.reset(); clock.t = day(8, 0);
  assert.deepStrictEqual([eta('library').source, eta('library').mins], ['typical', 10]);
  clock.t = day(12, 0);                           // never seen at noon: no guess
  assert.strictEqual(eta('library'), undefined);
  clock.t = day(8, 0); report('arrive', 'main-gate', 'u1');
  assert.strictEqual(eta('library').source, 'live');
});

// ---- timetable: Shuttle A leaves Main Gate at 7:30, 8:10, 8:50 ... ----
test('a shuttle early at the first stop waits for its departure time', () => {
  const { report, eta, wait } = setup(base, day(7, 25));
  report('arrive', 'main-gate', 'u1');
  const here = eta('main-gate');
  assert.strictEqual(here.mins, 0);
  assert.strictEqual(new Date(here.departs).getMinutes(), 30);       // "Now · leaves 7:30"
  assert.strictEqual(eta('library').mins, 5 + S.library.minsFromPrev); // 7:34, not 7:30
  assert.strictEqual(eta('library').late, false);
  wait(4);
  assert.strictEqual(eta('library').lateBy, 0);
});

test('a late shuttle is flagged "behind schedule" with how late it is', () => {
  const { report, eta, bus } = setup(base, day(7, 40));               // 10 min after its 7:30 departure
  report('arrive', 'main-gate', 'u1');
  const e = eta('library');
  assert.strictEqual(e.late, true);
  assert.strictEqual(e.lateBy, 11);                                    // due 7:34, now arriving 7:45
  assert.strictEqual(bus().late, true);
  assert.strictEqual(bus('B').pos, null);
});

test('before any reports, ETAs come from the timetable', () => {
  const { eta } = setup(base, day(7, 0));
  assert.deepStrictEqual({ ...eta('library') }, { bus: 'A', mins: 34, source: 'schedule' });
});

test('QR keys: with QR_SECRET set, reports must carry the key for that stop or shuttle', () => {
  process.env.QR_SECRET = 'test-secret';
  try {
    const { authorize, qrKey } = require('../server.js');
    const ks = qrKey('s', 'library'), kb = qrKey('b', 'A');
    assert.ok(authorize({ type: 'wait', stop: 'library', k: ks }));
    assert.ok(!authorize({ type: 'wait', stop: 'dorms', k: ks }));               // library's code can't report the dorms
    assert.ok(!authorize({ type: 'wait', stop: 'library' }));
    assert.ok(authorize({ type: 'arrive', stop: 'dorms', bus: 'A', k: kb }));    // riders on A can report any stop
    assert.ok(!authorize({ type: 'arrive', stop: 'dorms', bus: 'B', k: kb }));   // ...but only for A
    assert.ok(authorize({ type: 'gps', bus: 'A', k: kb }));
    assert.ok(!authorize({ type: 'gps', bus: 'A', k: ks }));
  } finally { delete process.env.QR_SECRET; }
});

test('with no recent sighting, a lone report far off the timetable waits for someone to agree', () => {
  const { report, bus, wait } = setup(base, day(7, 34));            // A is due at the Library now
  report('arrive', 'station', 'prank');                              // station is ~22 min off the timetable
  assert.strictEqual(bus().pos, null);
  wait(2); report('arrive', 'library', 'u1');                        // fits the timetable: accepted on its own
  assert.strictEqual(bus().pos.stop, 'library');
  // a genuinely very late shuttle: two people at consecutive stops agree, so both count
  const late = setup(base, day(7, 50));                              // 16 min after A's 7:34 Library time
  late.report('arrive', 'library', 'r1');
  assert.strictEqual(late.bus().pos, null);
  late.wait(6); late.report('arrive', 'dorms', 'r2');
  assert.strictEqual(late.bus().pos.stop, 'dorms');
  assert.strictEqual(late.bus().late, true);
});

test('people still waiting at a stop the shuttle was due at mean it hasn\'t come: ETA and lateness move', () => {
  const { report, eta, bus, wait } = setup(base, day(7, 28));
  report('arrive', 'main-gate', 'u1');                               // leaves 7:30, due at the Library 7:34
  wait(4); report('wait', 'library', 'w1'); report('wait', 'library', 'w2'); // 7:32: two people waiting there
  wait(9);                                                           // 7:41, nobody has said it arrived
  assert.strictEqual(eta('library').mins, 1);
  assert.strictEqual(eta('library').late, true);
  assert.strictEqual(bus().est.to, 'library');                       // map holds it before the Library
  report('arrive', 'library', 'w1');                                 // it finally shows up
  assert.strictEqual(bus().pos.stop, 'library');
});

test('a shuttle with no reports yet still counts, from the timetable', () => {
  const { report, eta, tr } = setup(base, day(7, 40));
  report('arrive', 'athletics', 'u1');                               // A is live, past the Library
  const lib = tr.buildState().stops.find(s => s.id === 'library').etas;
  assert.deepStrictEqual(lib.map(e => [e.bus, e.source]), [['B', 'schedule'], ['A', 'live']]);
  assert.strictEqual(eta('library').mins, 14);                       // B leaves Main Gate 7:50, Library 7:54
});
