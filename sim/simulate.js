// Simulates a morning of shuttle service against the real server logic, with a fake clock.
//
//   node sim/simulate.js            -> compare scenarios, print accuracy report
//   node sim/simulate.js --live     -> run the sim at 30x speed and serve the UI on :3000 to watch it
//
// "History" scenarios first simulate 10 earlier days so the app has past arrivals to learn from.
//
// The "true" shuttle drives the route with random traffic delays. Simulated students show up at
// stops, some tap "I'm waiting" / "The shuttle is here", some riders share location, and a
// prankster sends fake reports. We then check the app's ETA against when the shuttle really came.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.TZ = require('../config.json').timezone || process.env.TZ; // sim clock in the school's timezone
const LIVE = process.argv.includes('--live');
const START = new Date(); START.setHours(7, 30, 0, 0);
let simNow = START.getTime();
const realNow = Date.now;
Date.now = () => simNow; // the server reads time only through Date.now
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shuttle-sim-'));
const app = require('../server.js');
const { config } = app;
const MIN = 60_000, STEP = 30_000;
const N = config.stops.length;

// ---- deterministic random so runs are repeatable ----
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ---- the real shuttle's timeline: arrival/departure per stop, with traffic noise ----
function makeTimeline(rand, t0, hours) {
  const visits = []; let t = t0 + (rand() - 0.5) * 6 * MIN, i = 0; // first run leaves within ±3 min of 7:30
  while (t < t0 + hours * 60 * MIN) {
    visits.push({ stop: i, arrive: t, depart: t + MIN }); // 1 min dwell
    const next = (i + 1) % N;
    t += MIN + config.stops[next].minsFromPrev * (0.8 + rand() * 0.6) * MIN; // 80%–140% of scheduled
    i = next;
  }
  return visits;
}
function truePos(visits, now) { // lat/lng of the real shuttle right now
  for (let k = 0; k < visits.length - 1; k++) {
    const a = visits[k], b = visits[k + 1];
    if (now < a.arrive) break;
    if (now <= a.depart) return pt(a.stop);
    if (now < b.arrive) { const f = (now - a.depart) / (b.arrive - a.depart), p = pt(a.stop), q = pt(b.stop);
      return { lat: p.lat + (q.lat - p.lat) * f, lng: p.lng + (q.lng - p.lng) * f }; }
  }
  return null;
}
const pt = i => ({ lat: config.stops[i].lat, lng: config.stops[i].lng });
const nextArrival = (visits, stop, now) => visits.find(v => v.stop === stop && v.depart >= now);

// ---- one simulated day. Returns step() (advance 30 s) and score() ----
function day({ day = 0, hours = 3, seed = 7, waitTap = 0.4, hereTap = 0.3, rideTap = 0.1, gpsShare = 0,
  prankEvery = 0, prankGps = true, studentRate = 0.25, log = false }) {
  app.reset();
  const d0 = new Date(START); d0.setDate(d0.getDate() + day); // calendar day, so DST doesn't shift 7:30
  const t0 = d0.getTime(), end = t0 + hours * 60 * MIN;
  simNow = t0;
  const rand = rng(seed * 1000 + day + 500), visits = makeTimeline(rand, t0, hours);
  const waiting = Array.from({ length: N }, () => []); // students at each stop
  let onboard = [], nextId = 0, lastVisit = -1, steps = 0;
  const errors = { live: [], typical: [] }; let seen = 0, rejected = 0;
  const send = (body, who) => { const [code, msg] = app.handleReport({ ...body, device: who.id }, who.ip); if (code !== 200) rejected++; return msg; };
  const student = () => ({ id: `d${day}s${nextId}`, ip: '10.0.' + (nextId % 250) + '.' + (nextId++ % 7), shares: rand() < gpsShare });
  const prankster = { id: 'prank', ip: '10.9.9.9' };
  const say = (...a) => log && console.log(new Date(simNow).toTimeString().slice(0, 5), ...a);

  function step(score = true) {
    // students show up and maybe tap "I'm waiting"
    for (let s = 0; s < N; s++) if (rand() < studentRate * STEP / MIN) {
      const st = student(); waiting[s].push(st);
      if (rand() < waitTap) send({ type: 'wait', stop: config.stops[s].id, ...pt(s) }, st);
    }
    // shuttle arrives somewhere
    const v = visits.findIndex(x => x.arrive <= simNow && simNow < x.arrive + STEP);
    if (v >= 0 && v !== lastVisit) {
      lastVisit = v; const s = visits[v].stop, stopId = config.stops[s].id;
      let taps = 0;
      for (const st of waiting[s]) if (rand() < hereTap) { send({ type: 'arrive', stop: stopId, bus: 'A', ...pt(s) }, st); taps++; }
      for (const r of onboard) if (rand() < rideTap) { send({ type: 'arrive', stop: stopId, bus: 'A' }, r); taps++; }
      onboard = onboard.filter(() => rand() > 0.5).concat(waiting[s]); // half get off, everyone waiting gets on
      say(`🚌 shuttle at ${config.stops[s].name.padEnd(17)} ${String(waiting[s].length).padStart(2)} boarded, ${taps} tapped "here"`);
      waiting[s] = [];
    }
    // riders sharing location
    const p = truePos(visits, simNow);
    if (p) for (const r of onboard) if (r.shares) send({ type: 'gps', bus: 'A', lat: p.lat, lng: p.lng }, r);
    // prankster
    if (prankEvery && steps && steps % (prankEvery * 2) === 0) {
      const s = Math.floor(rand() * N);
      const msg = send({ type: 'arrive', stop: config.stops[s].id, bus: 'A', ...(prankGps ? { lat: 40.1, lng: -75.2 } : {}) }, prankster);
      say(`😈 prank "arrived at ${config.stops[s].name}"${prankGps ? ' from off-campus' : ''} -> ${msg}`);
    }
    if (steps % 4 === 0) app.recordHistory();
    // score: the app's ETA vs reality, for every stop
    let state;
    if (score) {
      state = app.buildState();
      for (let s = 0; s < N; s++) {
        const real = nextArrival(visits, s, simNow), est = state.stops[s].etas[0];
        if (!real) continue;
        seen++;
        if (est) errors[est.source].push(Math.abs(est.mins - Math.max(0, (real.arrive - simNow) / MIN)));
      }
    }
    simNow += STEP; steps++;
    return state;
  }
  const done = () => simNow >= end;
  function score() {
    const all = [...errors.live, ...errors.typical].sort((a, b) => a - b);
    const pct = f => all.length ? 100 * all.filter(f).length / all.length : NaN;
    return { coverage: 100 * all.length / seen, within2: pct(e => e <= 2), within5: pct(e => e <= 5),
      median: all.length ? all[all.length >> 1] : NaN, fromHistory: all.length ? 100 * errors.typical.length / all.length : 0, rejected };
  }
  return { step, done, score };
}
function runDay(opts, score = true) { const d = day(opts); while (!d.done()) d.step(score); return d.score(); }
function buildHistory(days, seed) { app.resetHistory(); for (let d = -days; d < 0; d++) runDay({ day: d, seed }, false); }

if (LIVE) {
  // 1 real second = 30 sim seconds. Open http://localhost:3000 to watch.
  buildHistory(10, 1);
  const d = day({ seed: 1, hours: 6, hereTap: 0.15, waitTap: 0.3, rideTap: 0.03, log: true });
  const port = process.env.PORT || 3000;
  app.server.listen(port, () => console.log(`Live sim at http://localhost:${port}  (1 s = 30 s of shuttle time; 10 past days of history loaded)`));
  setInterval(() => d.step(false), 1000);
} else {
  console.log('── Sample morning (QR taps + a prankster) ──');
  runDay({ hours: 1, prankEvery: 15, log: true }, false);
  const scenarios = [
    { name: 'Nobody reports, no history', waitTap: 0, hereTap: 0, rideTap: 0 },
    { name: 'Nobody reports today, 10 days history', waitTap: 0, hereTap: 0, rideTap: 0, history: 10 },
    { name: 'Low participation (10% tap)', waitTap: 0.1, hereTap: 0.1, rideTap: 0.02 },
    { name: 'Low participation + 10 days history', waitTap: 0.1, hereTap: 0.1, rideTap: 0.02, history: 10 },
    { name: 'Typical (30% tap)' },
    { name: 'Typical + 10 days history', history: 10 },
    { name: 'Typical + 10% riders share GPS', gpsShare: 0.1, history: 10 },
    { name: 'Typical + prankster (off-campus)', prankEvery: 10, history: 10 },
    { name: 'Typical + prankster (location off)', prankEvery: 10, prankGps: false, history: 10 },
  ];
  const SEEDS = [1, 2, 3, 4, 5, 6];
  const avg = (rs, k) => { const v = rs.map(r => r[k]).filter(Number.isFinite); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(k === 'median' ? 1 : 0) : '—'; };
  const rows = scenarios.map(({ history, ...sc }) => {
    const rs = SEEDS.map(seed => { if (history) buildHistory(history, seed); else app.resetHistory(); return runDay({ ...sc, seed }); });
    return { scenario: sc.name, 'has ETA %': avg(rs, 'coverage'), '±2 min %': avg(rs, 'within2'), '±5 min %': avg(rs, 'within5'),
      'median err (min)': avg(rs, 'median'), 'from history %': avg(rs, 'fromHistory'), 'rejected': avg(rs, 'rejected') };
  });
  console.log(`\n── ETA accuracy: ${SEEDS.length} random mornings x 3 h, every stop checked every 30 s ──`);
  console.table(rows);
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  Date.now = realNow;
}
