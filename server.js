// Shuttle tracker server. Zero dependencies: `node server.js`.
// The tracking logic lives in core.js; this file adds HTTP, saving to disk, and QR keys.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTracker } = require('./core.js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const config = JSON.parse(fs.readFileSync(process.env.CONFIG || path.join(__dirname, 'config.json'), 'utf8'));
const tracker = createTracker(config);

// ---- saving: raw reports (24 h) and history (60 days) ----
const FILES = { events: path.join(DATA_DIR, 'events.json'), history: path.join(DATA_DIR, 'history.json') };
const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
tracker.importData({ events: load(FILES.events), history: load(FILES.history) });
let saved = tracker.version;
function save() {
  tracker.trim();
  if (tracker.version === saved) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = tracker.exportData();
  fs.writeFileSync(FILES.events, JSON.stringify(d.events));
  fs.writeFileSync(FILES.history, JSON.stringify(d.history));
  saved = tracker.version;
}
setInterval(save, 10_000).unref();
setInterval(() => tracker.recordHistory(), 60_000).unref();

// ---- QR keys (optional) ----
// With QR_SECRET set, every printed QR code carries a key for its own stop or shuttle, so only someone who
// scanned the real code can report for that place. Keys are derived, so nothing extra is stored.
const qrKey = (kind, id) => process.env.QR_SECRET
  ? crypto.createHmac('sha256', process.env.QR_SECRET).update(`${kind}:${id}`).digest('base64url').slice(0, 10) : '';
function authorize(body) {
  if (!process.env.QR_SECRET) return true;
  const k = String(body.k || '');
  const stopOk = !!body.stop && k === qrKey('s', body.stop), busOk = !!body.bus && k === qrKey('b', body.bus);
  if (body.type === 'wait') return stopOk;
  if (body.type === 'gps') return busOk;
  return stopOk || busOk; // "arrive": from the stop's code, or from inside that shuttle
}
const adminOk = url => !!process.env.ADMIN_KEY && url.searchParams.get('key') === process.env.ADMIN_KEY;

// ---- http ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const SHARED = { '/core.js': path.join(__dirname, 'core.js'), '/world.js': path.join(__dirname, 'sim', 'world.js') };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (url.pathname === '/api/config') return send(res, 200, config);
  if (url.pathname === '/sim-config.js') return send(res, 200, `window.SHUTTLE_CONFIG = ${JSON.stringify(config)};`, 'text/javascript');
  if (url.pathname === '/api/state') return send(res, 200, tracker.buildState());
  if (url.pathname === '/api/report' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2000) req.destroy(); });
    req.on('end', () => {
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      if (!authorize(body)) return send(res, 403, { error: 'Scan the QR code at the stop or on the shuttle to report.' });
      const [code, msg] = tracker.handleReport(body, ip);
      send(res, code, code === 200 ? { ok: true, msg } : { error: msg });
    });
    return;
  }
  if (url.pathname === '/api/qr-links') { // what the printable QR page encodes
    if (process.env.QR_SECRET && !adminOk(url)) return send(res, 403, { error: 'Open this page as /qr?key=<ADMIN_KEY>.' });
    const q = (kind, id) => (qrKey(kind, id) ? `?k=${qrKey(kind, id)}` : '');
    return send(res, 200, [
      ...config.stops.map(s => ({ kind: 'stop', name: s.name, path: `/s/${s.id}${q('s', s.id)}` })),
      ...config.shuttles.map(b => ({ kind: 'shuttle', name: b.name, path: `/b/${b.id}${q('b', b.id)}` })),
    ]);
  }
  if (url.pathname === '/api/reset' && req.method === 'POST') {
    if (!adminOk(url)) return send(res, 403, { error: 'forbidden' });
    tracker.reset(); return send(res, 200, { ok: true });
  }

  // static files; /, /s/<stop>, /b/<shuttle> all load the app
  let file = url.pathname;
  if (file === '/' || file.startsWith('/s/') || file.startsWith('/b/')) file = '/index.html';
  if (file === '/qr') file = '/qr.html';
  if (file === '/sim') file = '/sim.html';
  const pub = path.join(__dirname, 'public');
  const fp = SHARED[file] || path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!SHARED[file] && !fp.startsWith(pub)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(fp, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(fp)] || 'application/octet-stream');
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Shuttle tracker on http://localhost:${PORT}  (simulator: /sim)`));
module.exports = { server, tracker, config, authorize, qrKey };
