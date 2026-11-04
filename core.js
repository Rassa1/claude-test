// Shuttle tracking core: turns rider reports into shuttle positions, ETAs and lateness.
// Pure logic with an injectable clock and no I/O, so the same code runs in the server (Node),
// the tests, and the in-browser simulator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShuttleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 60_000;

  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

  function createTracker(config, { now = () => Date.now() } = {}) {
    const N = config.stops.length;
    const DWELL = config.dwellMinutes ?? 1;                 // minutes stopped at each stop
    const LATE = config.lateMinutes ?? 4;                   // this far behind the timetable = "behind schedule"
    const STALE = (config.staleAfterMinutes ?? 45) * MIN;
    const WAIT_EXP = (config.waitingExpiresMinutes ?? 20) * MIN;
    const HISTORY_DAYS = config.historyDays ?? 60;
    const stopIdx = new Map(config.stops.map((s, i) => [s.id, i]));
    const busIds = new Set(config.shuttles.map(b => b.id));
    const cfgSeg = k => config.stops[k].minsFromPrev || 0;  // minutes driving into stop k from the stop before it

    let events = [];                              // raw reports, last 24 h
    let history = { arrivals: [], segs: [] };     // confirmed arrivals + real drive times, last HISTORY_DAYS
    let version = 0;                              // bumps on every change (the server saves when it moves)
    const hits = new Map(), lastRecorded = new Map();

    // ---- local time (the school's timezone; servers often run in UTC) ----
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone || undefined, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const lpCache = new Map(); // formatting is slow; cache per minute
    function localParts(t) {
      const key = Math.floor(t / MIN);
      let r = lpCache.get(key);
      if (!r) {
        const p = Object.fromEntries(fmt.formatToParts(key * MIN).map(x => [x.type, x.value]));
        r = { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, mins: +p.hour * 60 + +p.minute, weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
        if (lpCache.size > 5000) lpCache.clear();
        lpCache.set(key, r);
      }
      return r;
    }
    const atLocalMinute = (t, m) => t - (t % MIN) + (m - localParts(t).mins) * MIN; // that local time, same day as t

    // ---- timetable (optional): departures from the first stop; later stops follow configured drive times ----
    const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
    const schedules = new Map(config.shuttles.map(b => {
      const sc = b.schedule || config.schedule;
      if (!sc) return [b.id, null];
      const deps = sc.departures ? sc.departures.map(hm).sort((x, y) => x - y) : [];
      if (!sc.departures) for (let m = hm(sc.start); m <= hm(sc.end); m += sc.everyMinutes) deps.push(m);
      const period = sc.everyMinutes || (deps.length > 1 ? median(deps.slice(1).map((d, i) => d - deps[i])) : 60);
      return [b.id, { deps, period }];
    }));
    const schedOffset = [-DWELL]; // timetable minutes from leaving stop 0 to arriving at stop j
    for (let j = 1, acc = 0; j < N; j++) { acc += cfgSeg(j); schedOffset[j] = acc; acc += DWELL; }
    const schedTimes = (bus, j, t) => (schedules.get(bus)?.deps || []).map(m => atLocalMinute(t, m + schedOffset[j]));
    function schedNear(bus, j, t) { // timetable arrival at stop j closest to t
      const sc = schedules.get(bus); let best = null;
      for (const x of schedTimes(bus, j, t)) if (best == null || Math.abs(x - t) < Math.abs(best - t)) best = x;
      return best != null && Math.abs(best - t) <= sc.period * MIN ? best : null;
    }
    const schedNext = (bus, j, t) => schedTimes(bus, j, t).find(x => x >= t) ?? null;
    // when a shuttle that reached the first stop at `arrived` leaves it: waits for its timetable slot if early
    function departFirst(bus, arrived) {
      const ready = arrived + DWELL * MIN, sc = schedules.get(bus);
      if (!sc) return ready;
      const d = schedTimes(bus, 0, arrived).map(x => x + DWELL * MIN).find(x => x >= ready - sc.period * MIN / 2);
      return d == null ? ready : Math.max(ready, d);
    }
    const serviceOver = (bus, t) => { const sc = schedules.get(bus); if (!sc) return false;
      const last = schedTimes(bus, 0, t).at(-1); return last != null && t > last + sc.period * MIN; };

    // ---- rate limiting ----
    function limited(key, max, windowMs) {
      const t = now(), arr = (hits.get(key) || []).filter(x => t - x < windowMs);
      arr.push(t); hits.set(key, arr);
      return arr.length > max;
    }

    // ---- position model ----
    // An anchor {k, at} means the shuttle reached stop k at time `at`. A GPS fix between stops becomes an
    // anchor at the stop it last left, with `fix` recording how far along the next segment it was.
    function anchorOf(e) {
      const k = stopIdx.get(e.stop);
      if (e.type !== 'gps' || distM(e, config.stops[k]) < 50) return { k, at: e.t, e };
      let best = null;
      for (let to = 0; to < N; to++) {
        const from = (to - 1 + N) % N, A = config.stops[from], B = config.stops[to];
        const ab = distM(A, B) || 1, ap = distM(A, e), bp = distM(B, e);
        const f = Math.min(1, Math.max(0, (ap * ap - bp * bp + ab * ab) / (2 * ab * ab)));
        const off = ap + bp - ab; // 0 when exactly on the segment
        if (!best || off < best.off) best = { from, to, f, off };
      }
      return { k: best.from, at: e.t - (DWELL + best.f * cfgSeg(best.to)) * MIN, e, approx: { f: best.f, to: best.to, t: e.t } };
    }
    function baseSegs(t) { // typical drive time into each stop: median of past days near this hour, else config
      const h = localParts(t).hour;
      return config.stops.map((_, k) => {
        const all = history.segs.filter(x => x.to === k), near = all.filter(x => Math.abs(x.hour - h) <= 1);
        const use = (near.length >= 3 ? near : all).slice(-30).map(x => x.mins);
        return use.length >= 3 ? median(use) : cfgSeg(k);
      });
    }
    function learnSegments(anchors, base, bus) { // blend today's observed drive times into the typical ones
      const samples = Array.from({ length: N }, () => []);
      for (let x = 1; x < anchors.length; x++) {
        const a = anchors[x - 1], b = anchors[x], to = b.k;
        if (to !== (a.k + 1) % N || a.approx || b.approx) continue;
        const leave = a.k === 0 ? departFirst(bus, a.at) : a.at + DWELL * MIN; // minus any timetable wait
        const mins = (b.at - leave) / MIN, ref = cfgSeg(to);
        if (mins > 0.3 * ref && mins < 3 * ref + 2) samples[to].push(mins);
      }
      return samples.map((arr, k) => { const r = arr.slice(-3); return (base[k] + r.reduce((a, b) => a + b, 0)) / (r.length + 1); });
    }
    function travel(seg, i, j) { // minutes from arriving at stop i to arriving at stop j (a full loop if i === j)
      let m = 0, k = i;
      do { k = (k + 1) % N; m += DWELL + seg[k]; } while (k !== j);
      return m;
    }
    function busModel(busId, t, stale, base) {
      const evs = events.filter(e => e.bus === busId && (e.type === 'arrive' || e.type === 'gps') && t - e.t < 3 * 60 * MIN && e.t <= t);
      const anchors = [], flagged = new Map(); // device -> when it sent an impossible report
      const held = [];                           // lone reports that don't fit the timetable, waiting for support
      const sc = schedules.get(busId);
      for (const e of evs) {
        if (e.t - (flagged.get(e.device) ?? -Infinity) < 60 * MIN) continue; // distrust that phone for an hour
        const a = anchorOf(e), last = anchors[anchors.length - 1];
        if (last && last.k === a.k && a.at - last.at < 5 * MIN) { // same stop again: one anchor, more reporters
          last.devices.add(e.device); last.e = e;
          if (a.approx) last.fix = a.approx;
          continue;
        }
        if (e.type === 'arrive' && last && a.at - last.at < 45 * MIN) {
          // a lone "arrive" the shuttle couldn't have made yet (wrong stop / prank) waits for a 2nd reporter
          const elapsed = (a.at - last.at) / MIN, need = travel(learnSegments(anchors, base, busId), last.k, a.k);
          if (elapsed < 0.5 * need - 2) {
            const sus = (last.suspect ||= new Map()), who = sus.get(a.k) || new Set();
            who.add(e.device); sus.set(a.k, who);
            if (who.size < 2) { flagged.set(e.device, e.t); continue; }
          }
        } else if (e.type === 'arrive' && sc) {
          // nothing recent to check against: a report far off the timetable waits until someone else's
          // report agrees with it (the same stop, or a later stop it could plausibly have reached)
          const sched = schedNear(busId, a.k, a.at);
          if (sched == null || Math.abs(a.at - sched) > Math.max(12, 0.35 * sc.period) * MIN) {
            const seg = learnSegments(anchors, base, busId);
            const h = held.find(h => !h.devices.has(e.device) && (h.k === a.k ? a.at - h.at < 5 * MIN
              : (x => x >= 0.5 * travel(seg, h.k, a.k) - 2 && x <= 1.5 * travel(seg, h.k, a.k) + 5)((a.at - h.at) / MIN)));
            if (!h) { held.push({ ...a, devices: new Set([e.device]) }); continue; }
            held.splice(held.indexOf(h), 1);
            if (h.k === a.k) { h.devices.add(e.device); h.e = e; anchors.push(h); continue; }
            anchors.push(h);
          }
        }
        anchors.push({ ...a, devices: new Set([e.device]) });
      }
      const seg = learnSegments(anchors, base, busId);
      let cur = anchors[anchors.length - 1];
      if (!cur || t - cur.e.t > stale) return { seg, anchors, cur: null };
      const fix = cur.fix || cur.approx; // GPS between stops: when it left stop k, from today's drive time
      if (fix) cur = { ...cur, dep: fix.t - fix.f * seg[fix.to] * MIN };
      return { seg, anchors, cur };
    }
    const leaveTime = (bus, cur) => cur.dep ?? (cur.k === 0 ? departFirst(bus, cur.at) : cur.at + DWELL * MIN);
    // upcoming stops: {k, arrive, depart}. `waitSince[k]`: since when 2+ people have been waiting at stop k with no
    // arrival reported. If they were already waiting before the shuttle was due, it hasn't come yet.
    function* walk(bus, seg, cur, t, waitSince = []) {
      let i = cur.k, dep = leaveTime(bus, cur);
      for (let n = 0; n < N * 3; n++) {
        const k = (i + 1) % N, w = waitSince[k];
        let arrive = dep + seg[k] * MIN;
        if (w != null && arrive < t && w <= arrive - 0.5 * MIN) arrive = t + MIN;
        const depart = k === 0 ? departFirst(bus, arrive) : arrive + DWELL * MIN;
        yield { k, arrive, depart, leg: (arrive - dep) / MIN };
        i = k; dep = depart;
      }
    }
    function liveEta(bus, seg, cur, j, t, waitSince) {
      const leave = leaveTime(bus, cur);
      if (cur.k === j && cur.dep == null && t <= leave + 0.5 * MIN) return { mins: 0, at: cur.at, ...(leave - t > 2 * MIN && { departs: leave }) };
      let first = true;
      for (const v of walk(bus, seg, cur, t, waitSince)) {
        if (v.k !== j) continue;
        if (v.arrive >= t) return { mins: (v.arrive - t) / MIN, at: v.arrive };
        // expected already but nobody reported it: say "due" for a while instead of jumping a whole loop
        const over = (t - v.arrive) / MIN;
        if (first && over < Math.max(5, 0.5 * v.leg)) return { mins: 1, at: t + MIN, overdue: over };
        first = false;
      }
      return null;
    }
    function lateness(bus, j, eta) {
      const sched = schedNear(bus, j, eta.at);
      if (sched != null) { const by = Math.round((eta.at - sched) / MIN); return { late: by >= LATE, lateBy: by }; }
      return { late: (eta.overdue ?? 0) >= LATE, lateBy: null };
    }
    function positionAt(bus, seg, cur, t, waitSince) { // estimated {lat, lng} for the map
      const S = config.stops, lerp = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
      let prevK = cur.k, prevDep = leaveTime(bus, cur), first = true;
      const at = k => ({ lat: S[k].lat, lng: S[k].lng, stop: S[k].id, atStop: true });
      if (t <= prevDep) return at(prevK);
      for (const v of walk(bus, seg, cur, t, waitSince)) {
        if (t < v.arrive) return { ...lerp(S[prevK], S[v.k], (t - prevDep) / (v.arrive - prevDep)), from: S[prevK].id, to: S[v.k].id };
        if (first && (t - v.arrive) / MIN < Math.max(5, 0.5 * v.leg)) return { ...lerp(S[prevK], S[v.k], 0.97), from: S[prevK].id, to: S[v.k].id, due: true };
        if (t < v.depart) return at(v.k);
        prevK = v.k; prevDep = v.depart; first = false;
      }
      return null;
    }

    // ---- history ----
    function addArrival(bus, k, t, inferred) {
      const key = `${bus}|${k}`;
      if (Math.abs(t - (lastRecorded.get(key) ?? -Infinity)) < 5 * MIN) return false;
      if (history.arrivals.some(a => a.bus === bus && a.k === k && Math.abs(a.t - t) < 5 * MIN)) return false;
      lastRecorded.set(key, t);
      const lp = localParts(t);
      history.arrivals.push({ t, day: lp.day, weekend: lp.weekend, m: lp.mins, bus, stop: config.stops[k].id, k, ...(inferred && { inferred }) });
      version++;
      return true;
    }
    // save trustworthy arrivals: 2+ reporters, or followed by a later sighting (a lone prank that gets
    // contradicted is dropped). Stops nobody reported between two sightings are filled in.
    function recordHistory() {
      const t = now(), base = baseSegs(t);
      for (const b of config.shuttles) {
        const { anchors } = busModel(b.id, t, Infinity, base);
        const ok = (x, i) => x && !x.approx && t - x.at >= 2 * MIN && (x.devices.size >= 2 || i < anchors.length - 1);
        anchors.forEach((x, i) => {
          if (!ok(x, i) || !addArrival(b.id, x.k, x.at)) return;
          const prev = anchors[i - 1];
          if (!ok(prev, i - 1)) return;
          const hops = (x.k - prev.k + N) % N, mins = (x.at - prev.at) / MIN;
          if (hops === 1) {
            const drive = (x.at - (prev.k === 0 ? departFirst(b.id, prev.at) : prev.at + DWELL * MIN)) / MIN;
            if (drive > 0.3 * cfgSeg(x.k) && drive < 3 * cfgSeg(x.k) + 2)
              history.segs.push({ t: x.at, to: x.k, hour: localParts(x.at).hour, mins: +drive.toFixed(2) });
          } else if (hops > 1) {
            const expect = travel(base, prev.k, x.k);
            if (mins < 0.6 * expect || mins > 1.6 * expect) return;
            let acc = 0;
            for (let k = (prev.k + 1) % N; k !== x.k; k = (k + 1) % N) {
              acc += DWELL + base[k];
              addArrival(b.id, k, prev.at + (acc / expect) * (x.at - prev.at), true);
            }
          }
        });
      }
    }
    // "usually comes in ~N min": per past day (same weekday/weekend type when there's enough), the first
    // arrival at this stop after the current time of day; the median wait
    function typicalEta(stopId, t) {
      const { day, mins, weekend } = localParts(t);
      const pool = history.arrivals.filter(a => a.stop === stopId && a.day !== day);
      const same = pool.filter(a => a.weekend === weekend);
      const use = new Set(same.map(a => a.day)).size >= 3 ? same : pool;
      const days = new Map();
      for (const a of use) if (a.m >= mins - 1 && a.m - mins <= 90) days.set(a.day, Math.min(days.get(a.day) ?? Infinity, a.m - mins));
      const nDays = new Set(use.map(a => a.day)).size;
      if (days.size < 3 || days.size < nDays / 2) return null;
      return { mins: Math.max(0, Math.round(median([...days.values()]))), days: days.size };
    }

    // ---- public state ----
    function buildState() {
      const t = now(), base = baseSegs(t);
      const models = config.shuttles.map(b => ({ b, ...busModel(b.id, t, STALE, base) }));
      const lastArrivals = config.stops.map(s => events.findLast(e => e.stop === s.id && e.type === 'arrive' && e.t <= t));
      const waits = config.stops.map((s, j) => events.filter(e => e.stop === s.id && e.type === 'wait' && t - e.t < WAIT_EXP && e.t <= t
        && (!lastArrivals[j] || e.t > lastArrivals[j].t)));
      const waitSince = waits.map(w => { // when a 2nd person was waiting too (one silent waiter is weak evidence)
        const firsts = [...new Map(w.map(e => [e.device, e.t])).values()].sort((a, b) => a - b);
        return firsts.length >= 2 ? firsts[1] : null;
      });
      const stops = config.stops.map((s, j) => {
        const lastArrival = lastArrivals[j];
        const waiters = new Set(waits[j].map(e => e.device));
        const etas = [];
        for (const m of models) {
          if (!m.cur) continue;
          const e = liveEta(m.b.id, m.seg, m.cur, j, t, waitSince);
          if (e) etas.push({ bus: m.b.id, mins: Math.round(e.mins), source: 'live', ...lateness(m.b.id, j, e), ...(e.departs && { departs: e.departs }) });
        }
        if (!etas.length) { const ty = typicalEta(s.id, t); if (ty) etas.push({ ...ty, source: 'typical' }); }
        if (!etas.length) for (const m of models) {
          const x = schedNext(m.b.id, j, t);
          if (x != null && x - t < 3 * 60 * MIN) etas.push({ bus: m.b.id, mins: Math.round((x - t) / MIN), source: 'schedule' });
        }
        etas.sort((a, b) => a.mins - b.mins);
        return { id: s.id, waiting: waiters.size, lastArrival: lastArrival?.t || null, etas };
      });
      const buses = models.map(m => {
        const out = { id: m.b.id, name: m.b.name, pos: null, scheduled: schedules.has(m.b.id) && !!schedules.get(m.b.id) };
        if (!m.cur || serviceOver(m.b.id, t)) return out;
        const e = m.cur.e;
        out.pos = { stop: e.stop, at: e.t, via: e.type, reporters: m.cur.devices.size };
        out.est = positionAt(m.b.id, m.seg, m.cur, t, waitSince);
        // the stop riders should tap next: the one it's at (if not yet reported) or heading to
        const nextId = out.est?.atStop && out.est.stop !== e.stop ? out.est.stop
          : out.est?.to || config.stops[(m.cur.k + 1) % N].id;
        out.next = nextId;
        const ne = stops[stopIdx.get(nextId)].etas.find(x => x.bus === m.b.id && x.source === 'live');
        if (ne) { out.late = ne.late; out.lateBy = ne.lateBy; }
        return out;
      });
      const recent = events.filter(e => e.type !== 'gps' && e.t <= t).slice(-15).reverse()
        .map(({ t, type, stop, bus }) => ({ t, type, stop, bus }));
      return { now: t, buses, stops, recent };
    }

    // ---- reports ----
    function handleReport(body, ip = '') {
      const { type, stop, bus, lat, lng } = body;
      const device = String(body.device || '').slice(0, 64) || ip;
      if (!['wait', 'arrive', 'gps'].includes(type)) return [400, 'bad type'];
      if (limited('ip:' + ip, 40, MIN) || limited('dev:' + device, 20, MIN)) return [429, 'Too many reports. Try again in a minute.'];
      const e = { t: now(), type, device };
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasGeo) { e.lat = +lat.toFixed(5); e.lng = +lng.toFixed(5); }
      if (type === 'gps') {
        if (!hasGeo || !busIds.has(bus)) return [400, 'need bus + location'];
        let best = null;
        for (const s of config.stops) { const d = distM(e, s); if (!best || d < best.d) best = { s, d }; }
        if (best.d > 3000) return [400, 'You seem to be off the shuttle route.'];
        e.bus = bus; e.stop = best.s.id;
        if (limited('gps:' + device, 1, 20_000)) return [200, 'ok'];
      } else {
        if (!stopIdx.has(stop)) return [400, 'unknown stop'];
        e.stop = stop;
        if (type === 'arrive') {
          e.bus = busIds.has(bus) ? bus : config.shuttles[0].id;
          if (limited(`arr:${device}:${stop}`, 1, 3 * MIN)) return [200, 'already counted'];
          if (hasGeo && distM(e, config.stops[stopIdx.get(stop)]) > 800) return [400, 'You seem far from that stop.'];
        }
        if (type === 'wait' && limited(`wait:${device}:${stop}`, 1, 5 * MIN)) return [200, 'already counted'];
      }
      events.push(e); version++;
      return [200, 'ok'];
    }

    function trim() {
      const t = now();
      events = events.filter(e => t - e.t < 24 * 60 * MIN);
      const hcut = t - HISTORY_DAYS * 24 * 60 * MIN;
      history.arrivals = history.arrivals.filter(a => a.t > hcut);
      history.segs = history.segs.filter(x => x.t > hcut);
      for (const [k, arr] of hits) { const keep = arr.filter(x => t - x < 10 * MIN); keep.length ? hits.set(k, keep) : hits.delete(k); }
    }

    return {
      config, MIN, buildState, handleReport, recordHistory, trim, localParts, departFirst, schedTimes, schedNear, serviceOver,
      get version() { return version; },
      exportData: () => ({ events, history }),
      importData: d => { if (d.events) events = d.events; if (d.history) history = { arrivals: [], segs: [], ...d.history }; },
      reset: () => { events = []; hits.clear(); version++; },
      resetHistory: () => { history = { arrivals: [], segs: [] }; lastRecorded.clear(); version++; },
    };
  }

  return { createTracker, distM, MIN };
});
