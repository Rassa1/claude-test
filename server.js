// Crowd-sourced shuttle tracker. Zero dependencies: `node server.js`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'events.json');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const MIN = 60_000;

const stopIdx = new Map(config.stops.map((s, i) => [s.id, i]));
const busIds = new Set(config.shuttles.map(b => b.id));
const loopMins = config.loopMinutes || config.stops.reduce((a, s) => a + (s.minsFromPrev || 0), 0) || 30;

// ---- storage: an append-only event list, trimmed to the last 24h ----
let events = [];
try { events = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
let dirty = false;
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * MIN;
  events = events.filter(e => e.t > cutoff);
  if (!dirty) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(events));
  dirty = false;
}, 10_000).unref();

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
// minutes driving from stop index i forward (looping) to stop index j
function travelMins(i, j) {
  let m = 0, k = i;
  while (k !== j) { k = (k + 1) % config.stops.length; m += config.stops[k].minsFromPrev || 0; }
  return m;
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

// ---- derive live state from events ----
function buildState() {
  const now = Date.now();
  const stale = (config.staleAfterMinutes || 45) * MIN;
  const waitExp = (config.waitingExpiresMinutes || 20) * MIN;

  const buses = config.shuttles.map(b => {
    // latest position: a stop sighting (grouped so multiple reporters confirm it) or a GPS ping
    const sightings = events.filter(e => e.bus === b.id && (e.type === 'arrive' || e.type === 'gps') && now - e.t < stale);
    let pos = null;
    if (sightings.length) {
      const last = sightings[sightings.length - 1];
      const confirmers = new Set(sightings.filter(e => e.stop === last.stop && last.t - e.t < 3 * MIN).map(e => e.device));
      pos = { stop: last.stop, at: last.t, via: last.type, reporters: confirmers.size, lat: last.lat, lng: last.lng };
    }
    return { id: b.id, name: b.name, pos };
  });

  const stops = config.stops.map((s, j) => {
    const lastArrival = events.findLast(e => e.stop === s.id && e.type === 'arrive');
    const waiters = new Set(events
      .filter(e => e.stop === s.id && e.type === 'wait' && now - e.t < waitExp && (!lastArrival || e.t > lastArrival.t))
      .map(e => e.device));
    const etas = [];
    for (const b of buses) {
      if (!b.pos) continue;
      const i = stopIdx.get(b.pos.stop);
      let mins = travelMins(i, j) - (now - b.pos.at) / MIN;
      if (i === j && now - b.pos.at < 2 * MIN) mins = 0; // it's there now
      while (mins < -2) mins += loopMins;                // it's probably on its next loop
      etas.push({ bus: b.id, mins: Math.max(0, Math.round(mins)) });
    }
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

http.createServer((req, res) => {
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
}).listen(PORT, () => console.log(`Shuttle tracker on http://localhost:${PORT}`));
