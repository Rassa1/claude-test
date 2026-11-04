// A simulated campus: shuttles drive the loop with random traffic, students show up at stops and
// (sometimes) tap the QR pages, riders may share location, pranksters send fake reports.
// Everything is fed into a tracker from core.js, and every ETA the app shows is scored against what
// really happened. Used by `npm run sim` (Node) and the interactive simulator page (browser).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShuttleWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 60_000, STEP = 15_000;
  function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

  // clock: { t } shared with the tracker's now(); start: when the day begins (ms)
  function createWorld({ tracker, clock, start, seed = 1, opts = {}, endAt = Infinity }) {
    const config = tracker.config, S = config.stops, N = S.length, DWELL = config.dwellMinutes ?? 1;
    const rand = rng(seed);
    const o = Object.assign({ waitTap: 0.4, hereTap: 0.3, rideTap: 0.1, gpsShare: 0, studentRate: 0.25, jamChance: 0.04 }, opts);
    const pt = i => ({ lat: S[i].lat, lng: S[i].lng });
    const log = [], listeners = [];
    const say = (text, kind = 'info') => { const x = { t: clock.t, text, kind }; log.push(x); if (log.length > 200) log.shift(); listeners.forEach(f => f(x)); };
    clock.t = start;

    // ---- shuttles: each shows up at the first stop just before its first timetable departure ----
    const buses = config.shuttles.map((b, i) => {
      const first = tracker.schedTimes(b.id, 0, start)[0];
      const arriveAt = (first ?? start + i * 20 * MIN) - (1 + rand() * 3) * MIN;
      return { id: b.id, name: b.name, mode: 'off', k: 0, t0: start, t1: arriveAt, extra: 0, onboard: [] };
    });
    const waiting = Array.from({ length: N }, () => []);
    let nextId = 0, rejected = 0;
    const student = () => ({ id: `s${seed}-${nextId}`, ip: `10.${(nextId >> 8) & 255}.${nextId & 255}.${nextId++ % 7}`, shares: rand() < o.gpsShare });
    const send = (body, who) => { const [code, msg] = tracker.handleReport({ ...body, device: who.id }, who.ip); if (code !== 200) rejected++; return [code, msg]; };

    // ---- scoring: every ETA shown is checked against the next real arrival at that stop ----
    const pending = Array.from({ length: N }, () => []);
    const score = { errors: { live: [], typical: [], schedule: [] }, none: 0, late: { tp: 0, fp: 0, fn: 0, tn: 0 } };
    function observe(state) {
      state.stops.forEach((st, j) => {
        pending[j].push({ p: clock.t, e: st.etas[0] || null });
        const here = buses.find(b => b.mode === 'stop' && b.k === j); // a shuttle is sitting there right now
        if (here) resolve(j, here, here.t0);
      });
    }
    function resolve(j, bus, T) {
      const sched = tracker.schedNear(bus.id, j, T);
      const reallyLate = sched != null && (T - sched) / MIN >= (config.lateMinutes ?? 4);
      for (const { p, e } of pending[j]) {
        if (!e) { score.none++; continue; }
        score.errors[e.source].push(Math.abs(e.mins - Math.max(0, T - p) / MIN));
        if (e.source === 'live' && e.bus === bus.id && T - p < 20 * MIN) {
          const said = !!e.late;
          score.late[said ? (reallyLate ? 'tp' : 'fp') : (reallyLate ? 'fn' : 'tn')]++;
        }
      }
      pending[j] = [];
    }

    // ---- shuttle movement ----
    function arrive(b, k) {
      b.mode = 'stop'; b.k = k; b.t0 = clock.t;
      if (k === 0 && tracker.serviceOver(b.id, clock.t)) { b.mode = 'done'; say(`${b.name} finished for the day`); return; }
      b.t1 = k === 0 ? tracker.departFirst(b.id, clock.t) : clock.t + DWELL * MIN;
      resolve(k, b, clock.t);
      let taps = 0;
      for (const st of waiting[k]) if (rand() < (st.engaged ? Math.min(1, o.hereTap * 2) : o.hereTap)) { send({ type: 'arrive', stop: S[k].id, bus: b.id, ...pt(k) }, st); taps++; }
      for (const r of b.onboard) if (rand() < o.rideTap) { send({ type: 'arrive', stop: S[k].id, bus: b.id }, r); taps++; }
      const boarded = waiting[k].length;
      b.onboard = b.onboard.filter(() => rand() > 0.5).concat(waiting[k]);
      waiting[k] = [];
      say(`${b.name} at ${S[k].name}: ${boarded} boarded, ${taps} tapped “here”`, 'bus');
    }
    function depart(b) {
      const to = (b.k + 1) % N;
      let mins = S[to].minsFromPrev * (0.8 + rand() * 0.6);
      if (rand() < o.jamChance) { mins += 5 + rand() * 7; }
      mins += b.extra; b.extra = 0;
      b.mode = 'drive'; b.from = b.k; b.k = to; b.t0 = clock.t; b.t1 = clock.t + mins * MIN;
    }
    function positionOf(b, t = clock.t) {
      if (b.mode === 'off' || b.mode === 'done') return null;
      if (b.mode === 'stop') return pt(b.k);
      const f = Math.min(1, (t - b.t0) / (b.t1 - b.t0)), p = pt(b.from), q = pt(b.k);
      return { lat: p.lat + (q.lat - p.lat) * f, lng: p.lng + (q.lng - p.lng) * f };
    }

    function step() {
      clock.t += STEP;
      for (let s = 0; s < N; s++) if (rand() < o.studentRate * STEP / MIN) {
        const st = student(); waiting[s].push(st);
        if (rand() < o.waitTap) { st.engaged = true; send({ type: 'wait', stop: S[s].id, ...pt(s) }, st); }
      }
      for (const b of buses) {
        if (b.mode === 'off' && clock.t >= b.t1) arrive(b, 0);
        else if (b.mode === 'stop' && clock.t >= b.t1) depart(b);
        else if (b.mode === 'drive' && clock.t >= b.t1) arrive(b, b.k);
        const p = positionOf(b);
        if (p) for (const r of b.onboard) if (r.shares) send({ type: 'gps', bus: b.id, ...p }, r);
      }
      if (Math.round(clock.t / STEP) % 8 === 0) tracker.recordHistory(); // every 2 min
    }
    // advance to time t (scoring every 30 s if `scoring`)
    function runUntil(t, scoring = true) {
      while (clock.t + STEP <= Math.min(t, endAt)) {
        step();
        if (scoring && Math.round(clock.t / STEP) % 2 === 0) observe(tracker.buildState());
      }
    }

    return {
      buses, waiting, log, score, opts: o, onLog: f => listeners.push(f),
      positionOf, runUntil, step, observe,
      get rejected() { return rejected; },
      jam(busId, mins = 10) {
        const b = buses.find(x => x.id === busId); if (!b) return;
        if (b.mode === 'drive') b.t1 += mins * MIN; else b.extra += mins;
        say(`Traffic jam: ${b.name} delayed ${mins} min`, 'jam');
      },
      prank(withLocation = false) {
        const b = buses.find(x => x.mode !== 'off' && x.mode !== 'done') || buses[0];
        const far = (b.k + 2 + Math.floor(rand() * (N - 3))) % N; // a stop the shuttle is nowhere near
        const [code, msg] = send({ type: 'arrive', stop: S[far].id, bus: b.id, ...(withLocation ? { lat: 40.1, lng: -75.2 } : {}) }, { id: 'prankster', ip: '10.66.6.6' });
        say(`Prank: fake “${b.name} at ${S[far].name}”${code === 200 ? '' : ` (rejected: ${msg})`}`, 'prank');
      },
    };
  }

  function summarize(score) {
    const all = [...score.errors.live, ...score.errors.typical, ...score.errors.schedule].sort((a, b) => a - b);
    const total = all.length + score.none, L = score.late;
    const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
    return {
      coverage: pct(all.length, total), within2: pct(all.filter(e => e <= 2).length, all.length),
      within5: pct(all.filter(e => e <= 5).length, all.length), median: all.length ? all[all.length >> 1] : null,
      fromHistory: pct(score.errors.typical.length, all.length),
      lateCaught: pct(L.tp, L.tp + L.fn), falseLate: pct(L.fp, L.fp + L.tn), lateCases: L.tp + L.fn,
    };
  }

  return { createWorld, summarize, rng, STEP };
});
