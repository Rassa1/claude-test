// Crowd-sourced shuttle tracker. Zero dependencies: `node server.js`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'events.json');
const config = JSON.parse(fs.readFileSync(process.env.CONFIG || path.join(__dirname, 'config.json'), 'utf8'));
const MIN = 60_000;

const stopIdx = new Map(config.stops.map((s, i) => [s.id, i]));
const busIds = new Set(config.shuttles.map(b => b.id));

// ---- storage: an append-only event list, trimmed to the last 24h ----
let events = [];
try { events = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
let dirty = false;
setInterval(() => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cutoff = Date.now() - 24 * 60 * MIN;
  events = events.filter(e => e.t > cutoff);
  if (!dirty) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(events));
  dirty = false;
  if (histDirty) {
    const hcut = Date.now() - HISTORY_DAYS * 24 * 60 * MIN;
    history.arrivals = history.arrivals.filter(a => a.t > hcut);
    history.segs = history.segs.filter(x => x.t > hcut);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
    histDirty = false;
  }
}, 10_000).unref();

// ---- history: confirmed arrivals + real drive times from past days (kept HISTORY_DAYS) ----
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_DAYS = config.historyDays || 60;
let history = { arrivals: [], segs: [] };
try { history = { ...history, ...JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) }; } catch {}
let histDirty = false;

// day / minute-of-day / hour in the school's timezone (servers often run in UTC)
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone || undefined, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function localParts(t) {
  const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, mins: +p.hour * 60 + +p.minute, weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// ---- helpers ----
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function nearestStop(p) {
  let best = null;
  for (const s of config.stops) {
    const d = distM(p, s);
    if (!best || d < best.d) best = { stop: s, d };
  }
  return best;
}
// ---- rate limiting ----
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 10 * MIN).unref();

// ---- position model ----
// An "anchor" is {k, at}: the shuttle was (or, for GPS between stops, effectively was) at stop k at time `at`.
const N = config.stops.length;
const DWELL = config.dwellMinutes ?? 1;
const cfgSeg = k => config.stops[k].minsFromPrev || 0; // minutes driving into stop k from the stop before it

function anchorOf(e) {
  const k = stopIdx.get(e.stop);
  if (e.type !== 'gps' || distM(e, config.stops[k]) < 50) return { k, at: e.t, e };
  // between stops: find the route segment the point lies on and back-date to its start stop
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

// typical drive time into each stop: median of past days around this hour, else config
function baseSegs(now) {
  const h = localParts(now).hour;
  return config.stops.map((_, k) => {
    const all = history.segs.filter(x => x.to === k), near = all.filter(x => Math.abs(x.hour - h) <= 1);
    const use = (near.length >= 3 ? near : all).slice(-30).map(x => x.mins);
    return use.length >= 3 ? median(use) : cfgSeg(k);
  });
}

// learn today's real drive times from consecutive stop sightings (blended with the typical time)
function learnSegments(anchors, base) {
  const samples = Array.from({ length: N }, () => []);
  for (let x = 1; x < anchors.length; x++) {
    const a = anchors[x - 1], b = anchors[x], to = b.k;
    if (to !== (a.k + 1) % N) continue;
    if (a.approx || b.approx) continue; // only learn from real at-stop sightings
    const mins = (b.at - a.at) / MIN - DWELL, ref = cfgSeg(to);
    if (mins > 0.3 * ref && mins < 3 * ref + 2) samples[to].push(mins);
  }
  return samples.map((arr, k) => {
    const recent = arr.slice(-3);
    return (base[k] + recent.reduce((a, b) => a + b, 0)) / (recent.length + 1);
  });
}
function travel(seg, i, j) { // minutes from arriving at stop i to arriving at stop j (a full loop if i === j)
  let m = 0, k = i;
  do { k = (k + 1) % N; m += DWELL + seg[k]; } while (k !== j);
  return m;
}

function busModel(busId, now, stale, base) {
  const evs = events.filter(e => e.bus === busId && (e.type === 'arrive' || e.type === 'gps') && now - e.t < 3 * 60 * MIN);
  // collapse repeated reports at the same stop into one anchor (earliest = actual arrival), count reporters
  const anchors = [], flagged = new Map(); // device -> time it sent an impossible report
  for (const e of evs) {
    if (e.t - (flagged.get(e.device) ?? -Infinity) < 60 * MIN) continue; // distrust that phone for an hour
    const a = anchorOf(e), last = anchors[anchors.length - 1];
    if (last && last.k === a.k && a.at - last.at < 5 * MIN) {
      last.devices.add(e.device); last.e = e;
      if (a.approx) last.fix = a.approx; // keep the freshest between-stops GPS fix
      continue;
    }
    // a lone "arrive" the shuttle couldn't physically have made yet (wrong stop / prank) is held
    // back until a second person reports the same stop
    if (last && e.type === 'arrive') {
      const elapsed = (a.at - last.at) / MIN, need = travel(learnSegments(anchors, base), last.k, a.k);
      if (elapsed < 0.5 * need - 2) {
        const sus = (last.suspect ||= new Map());
        const who = sus.get(a.k) || new Set(); who.add(e.device); sus.set(a.k, who);
        if (who.size < 2) { flagged.set(e.device, e.t); continue; }
      }
    }
    anchors.push({ ...a, devices: new Set([e.device]) });
  }
  const seg = learnSegments(anchors, base);
  let cur = anchors[anchors.length - 1];
  if (!cur || now - cur.e.t > stale) return { seg, anchors, pos: null };
  // a GPS fix between stops: back-date it to its segment's start using today's learned drive time
  const fix = cur.fix || cur.approx;
  if (fix) cur = { ...cur, at: fix.t - (DWELL + fix.f * seg[fix.to]) * MIN };
  return { seg, anchors, cur, pos: { stop: cur.e.stop, at: cur.e.t, via: cur.e.type, reporters: cur.devices.size } };
}

// save trustworthy arrivals to history: 2+ reporters, or followed by a later sighting (so a lone
// prank that gets contradicted is dropped). Stops nobody reported between two sightings are filled in.
const lastRecorded = new Map();
function addArrival(bus, k, t, inferred) {
  const key = `${bus}|${k}`;
  if (Math.abs(t - (lastRecorded.get(key) ?? -Infinity)) < 5 * MIN) return false;
  if (history.arrivals.some(a => a.bus === bus && a.k === k && Math.abs(a.t - t) < 5 * MIN)) return false;
  lastRecorded.set(key, t);
  const lp = localParts(t);
  history.arrivals.push({ t, day: lp.day, weekend: lp.weekend, m: lp.mins, bus, stop: config.stops[k].id, k, ...(inferred && { inferred }) });
  return (histDirty = true);
}
function recordHistory(now = Date.now()) {
  const base = baseSegs(now);
  for (const b of config.shuttles) {
    const { anchors } = busModel(b.id, now, Infinity, base);
    const ok = (x, i) => x && !x.approx && now - x.at >= 2 * MIN && (x.devices.size >= 2 || i < anchors.length - 1);
    anchors.forEach((x, i) => {
      if (!ok(x, i) || !addArrival(b.id, x.k, x.at)) return;
      const prev = anchors[i - 1];
      if (!ok(prev, i - 1)) return;
      const hops = (x.k - prev.k + N) % N, mins = (x.at - prev.at) / MIN;
      if (hops === 1) {
        const drive = mins - DWELL;
        if (drive > 0.3 * cfgSeg(x.k) && drive < 3 * cfgSeg(x.k) + 2)
          history.segs.push({ t: x.at, to: x.k, hour: localParts(x.at).hour, mins: +drive.toFixed(2) });
      } else if (hops > 1) {
        // fill in skipped stops, spaced by typical drive times, if the gap is a plausible single pass
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
setInterval(() => recordHistory(), MIN).unref();

// "usually comes in ~N min": on each past day (same weekday/weekend type when there's enough),
// find the first arrival at this stop after the current time of day; take the median wait
function typicalEta(stopId, now) {
  const { day, mins, weekend } = localParts(now);
  const pool = history.arrivals.filter(a => a.stop === stopId && a.day !== day);
  const same = pool.filter(a => a.weekend === weekend);
  const use = new Set(same.map(a => a.day)).size >= 3 ? same : pool;
  const days = new Map();
  for (const a of use) if (a.m >= mins - 1 && a.m - mins <= 90) days.set(a.day, Math.min(days.get(a.day) ?? Infinity, a.m - mins));
  const nDays = new Set(use.map(a => a.day)).size;
  if (days.size < 3 || days.size < nDays / 2) return null; // not enough evidence it runs at this time
  return { mins: Math.max(0, Math.round(median([...days.values()]))), days: days.size };
}

// ---- derive live state from events ----
function buildState() {
  const now = Date.now();
  const stale = (config.staleAfterMinutes || 45) * MIN;
  const waitExp = (config.waitingExpiresMinutes || 20) * MIN;

  const base = baseSegs(now);
  const models = config.shuttles.map(b => ({ b, ...busModel(b.id, now, stale, base) }));
  const buses = models.map(({ b, pos }) => ({ id: b.id, name: b.name, pos }));

  const stops = config.stops.map((s, j) => {
    const lastArrival = events.findLast(e => e.stop === s.id && e.type === 'arrive');
    const waiters = new Set(events
      .filter(e => e.stop === s.id && e.type === 'wait' && now - e.t < waitExp && (!lastArrival || e.t > lastArrival.t))
      .map(e => e.device));
    const etas = [];
    for (const { b, seg, cur } of models) {
      if (!cur) continue;
      const elapsed = (now - cur.at) / MIN;
      if (cur.k === j && elapsed <= DWELL + 0.5) { etas.push({ bus: b.id, mins: 0, source: 'live' }); continue; }
      const t = travel(seg, cur.k, j);
      let mins = t - elapsed;
      // running late: say "due" (1 min) rather than jumping to the next loop, until it's clearly missed
      if (mins < 0 && -mins < Math.max(5, 0.5 * t)) mins = 1;
      while (mins < 0) mins += travel(seg, j, j);
      etas.push({ bus: b.id, mins: Math.round(mins), source: 'live' });
    }
    if (!etas.length) { const t = typicalEta(s.id, now); if (t) etas.push({ ...t, source: 'typical' }); }
    etas.sort((a, b) => a.mins - b.mins);
    return { id: s.id, waiting: waiters.size, lastArrival: lastArrival?.t || null, etas };
  });

  const recent = events.filter(e => e.type !== 'gps').slice(-15).reverse()
    .map(({ t, type, stop, bus }) => ({ t, type, stop, bus }));
  return { now, buses, stops, recent };
}

// ---- report handling ----
function handleReport(body, ip) {
  const { type, stop, bus, lat, lng } = body;
  const device = String(body.device || '').slice(0, 64) || ip;
  if (!['wait', 'arrive', 'gps'].includes(type)) return [400, 'bad type'];
  if (limited('ip:' + ip, 40, MIN) || limited('dev:' + device, 20, MIN)) return [429, 'slow down'];

  const e = { t: Date.now(), type, device };
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  if (hasGeo) { e.lat = +lat.toFixed(5); e.lng = +lng.toFixed(5); }

  if (type === 'gps') {
    if (!hasGeo || !busIds.has(bus)) return [400, 'need bus + location'];
    const n = nearestStop(e);
    if (n.d > 3000) return [400, 'too far from route'];
    e.bus = bus; e.stop = n.stop.id;
    if (limited('gps:' + device, 1, 20_000)) return [200, 'ok'];
  } else {
    if (!stopIdx.has(stop)) return [400, 'unknown stop'];
    e.stop = stop;
    if (type === 'arrive') {
      e.bus = busIds.has(bus) ? bus : config.shuttles[0].id;
      // one arrival per device per stop every 3 min
      if (limited(`arr:${device}:${stop}`, 1, 3 * MIN)) return [200, 'already counted'];
      // if they shared location, it must be plausibly near the stop
      if (hasGeo && distM(e, config.stops[stopIdx.get(stop)]) > 800) return [400, 'you seem far from that stop'];
    }
    if (type === 'wait' && limited(`wait:${device}:${stop}`, 1, 5 * MIN)) return [200, 'already counted'];
  }
  events.push(e); dirty = true;
  return [200, 'ok'];
}

// ---- http ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (url.pathname === '/api/config') return send(res, 200, { title: config.title, shuttles: config.shuttles, stops: config.stops });
  if (url.pathname === '/api/state') return send(res, 200, buildState());
  if (url.pathname === '/api/report' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2000) req.destroy(); });
    req.on('end', () => {
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      const [code, msg] = handleReport(body, ip);
      send(res, code, code === 200 ? { ok: true, msg } : { error: msg });
    });
    return;
  }
  if (url.pathname === '/api/reset' && req.method === 'POST') {
    if (!ADMIN_KEY || url.searchParams.get('key') !== ADMIN_KEY) return send(res, 403, { error: 'forbidden' });
    events = []; dirty = true; return send(res, 200, { ok: true });
  }

  // static files; /, /s/:stop, /b/:bus all load the single-page app
  let file = url.pathname;
  if (file === '/' || file.startsWith('/s/') || file.startsWith('/b/')) file = '/index.html';
  if (file === '/qr') file = '/qr.html';
  const fp = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(path.join(__dirname, 'public'))) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(fp, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(fp)] || 'application/octet-stream');
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Shuttle tracker on http://localhost:${PORT}`));
module.exports = { server, config, buildState, handleReport, recordHistory,
  reset: () => { events = []; hits.clear(); },
  resetHistory: () => { history = { arrivals: [], segs: [] }; lastRecorded.clear(); } };
