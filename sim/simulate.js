// Scores the tracker against simulated mornings.  `npm run sim`
// For a hands-on version, run the server and open /sim (or open dist/shuttle-sim.html).
//
// Each scenario runs several random mornings (07:20-10:20). "History" scenarios first simulate 10
// earlier days so the app has past arrivals to learn from.
const config = require('../config.json');
process.env.TZ = config.timezone || process.env.TZ; // sim clock in the school's timezone
const { createTracker } = require('../core.js');
const { createWorld, summarize } = require('./world.js');

const SEEDS = [1, 2, 3, 4, 5, 6];
const MIN = 60_000;
const dayStart = d => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(7, 20, 0, 0); return x.getTime(); };

function runScenario({ history = 0, hours = 3, prankEvery = 0, prankLocation = true, ...opts }, seed) {
  const clock = { t: 0 };
  const tracker = createTracker(config, { now: () => clock.t });
  for (let d = -history; d < 0; d++) { // past days, no scoring
    tracker.reset();
    const w = createWorld({ tracker, clock, start: dayStart(d), seed: seed * 100 + d + 50 });
    w.runUntil(dayStart(d) + hours * 60 * MIN, false);
  }
  tracker.reset();
  const start = dayStart(0), w = createWorld({ tracker, clock, start, seed, opts });
  for (let t = start; t < start + hours * 60 * MIN; t += 5 * MIN) {
    w.runUntil(t + 5 * MIN);
    if (prankEvery && ((t - start) / MIN) % prankEvery === 0 && t > start) w.prank(prankLocation);
  }
  return { ...summarize(w.score), rejected: w.rejected };
}

console.log('── Sample hour: 2 shuttles, QR taps, a traffic jam, a prankster ──');
{
  const clock = { t: 0 }, tracker = createTracker(config, { now: () => clock.t });
  const start = dayStart(0), w = createWorld({ tracker, clock, start, seed: 3, opts: { jamChance: 0 } });
  w.onLog(x => console.log(new Date(x.t).toTimeString().slice(0, 5), x.text));
  w.runUntil(start + 25 * MIN); w.jam('A', 10);
  w.runUntil(start + 40 * MIN); w.prank(false);
  w.runUntil(start + 42 * MIN);
  for (const b of tracker.buildState().buses)
    console.log(`      app says: ${b.name} heading to ${b.next ?? '?'}, ${b.late ? `BEHIND SCHEDULE (+${b.lateBy} min)` : 'on time'}`);
  w.runUntil(start + 60 * MIN);
}

const scenarios = [
  { name: 'Nobody reports, no history', waitTap: 0, hereTap: 0, rideTap: 0 },
  { name: 'Nobody reports today, 10 days history', waitTap: 0, hereTap: 0, rideTap: 0, history: 10 },
  { name: 'Low participation (10% tap)', waitTap: 0.1, hereTap: 0.1, rideTap: 0.02 },
  { name: 'Low participation + history', waitTap: 0.1, hereTap: 0.1, rideTap: 0.02, history: 10 },
  { name: 'Typical (30% tap) + history', history: 10 },
  { name: 'Typical + 10% riders share GPS', gpsShare: 0.1, history: 10 },
  { name: 'Typical + prankster (off-campus)', prankEvery: 10, history: 10 },
  { name: 'Typical + prankster (location off)', prankEvery: 10, prankLocation: false, history: 10 },
];
const avg = (rs, k, dp = 0) => { const v = rs.map(r => r[k]).filter(x => x != null && Number.isFinite(x)); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(dp) : '—'; };
const rows = scenarios.map(({ name, ...sc }) => {
  const rs = SEEDS.map(seed => runScenario(sc, seed));
  return { scenario: name, 'has ETA %': avg(rs, 'coverage'), '±2 min %': avg(rs, 'within2'), '±5 min %': avg(rs, 'within5'),
    'median err': avg(rs, 'median', 1), 'late caught %': avg(rs, 'lateCaught'), 'false late %': avg(rs, 'falseLate'), rejected: avg(rs, 'rejected') };
});
console.log(`\n── ETA accuracy: ${SEEDS.length} random mornings × 3 h, 2 shuttles, every stop checked every 30 s ──`);
console.table(rows);
console.log('late caught = when a shuttle really was ≥4 min behind the timetable, how often the app said so');
console.log('false late  = how often it said "behind schedule" when the shuttle was on time');
