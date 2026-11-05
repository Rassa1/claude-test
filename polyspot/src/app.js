// HTTP request handler: JSON API + static files. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore, localDate } from './store.js';
import scoring from '../shared/scoring.config.js';
import { scoreGuess } from '../shared/scoring.js';
import { clampPos, isValidPos, mapSpan, norm360 } from '../shared/geo.js';
import { fetchOsmFeatures } from './osm.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const MAX_BODY = 20 * 1024 * 1024; // photos arrive base64-encoded; the browser already shrinks them to ~0.5 MB
const MAX_PHOTO = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const newId = () => crypto.randomBytes(6).toString('base64url');
const num = v => (v === '' || v == null ? NaN : Number(v));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Upload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, root, rel, cache = 'no-store') {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(root + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Accepts a data: URL from the browser and checks the bytes really are a JPEG, PNG or WebP. */
function decodePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Add a photo (JPEG, PNG or WebP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_PHOTO) fail(413, 'Photo too large');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isWebp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!(isJpeg || isPng || isWebp)) fail(400, 'That file is not a supported image');
  return { buf, ext: isJpeg ? 'jpg' : isPng ? 'png' : 'webp' };
}

/**
 * @param {{ dataDir: string, seedDir?: string, info?: () => object }} opts
 *   info() supplies extra fields for GET /api/info (the LAN URLs server.js found).
 */
export function createApp({ dataDir, seedDir = path.join(ROOT, 'seed'), info = () => ({}) }) {
  const store = openStore(dataDir, seedDir);
  const { db } = store;

  const findMap = id => db.maps.find(m => m.id === id) || fail(404, 'Map not found');
  const findRound = id => db.rounds.find(r => r.id === id) || fail(404, 'Round not found');
  const guessesFor = id => db.guesses.filter(g => g.roundId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  /** A round as players see it: everything except the answer. */
  function publicRound(r) {
    const gs = guessesFor(r.id);
    return {
      id: r.id, mapId: r.mapId, title: r.title, difficulty: r.difficulty, date: r.date, createdAt: r.createdAt,
      photoUrl: `/photos/${r.photo}`,
      plays: gs.length,
      best: gs.length ? Math.max(...gs.map(g => g.total)) : null,
    };
  }

  const latLng = p => ({ lat: num(p?.lat), lng: num(p?.lng) });
  const FEATURE_KINDS = ['building', 'parking', 'place', 'custom'];

  function cleanMap(b, prev) {
    const type = prev?.type || (b.type === 'latlng' ? 'latlng' : 'floorplan');
    const map = {
      id: prev?.id || newId(),
      type,
      name: str(b.name, 60) || 'Untitled map',
      units: b.units === 'm' ? 'm' : 'ft', // for showing distances
      createdAt: prev?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (type === 'floorplan') {
      const width = num(b.width), length = num(b.length);
      if (!(width >= 0.3 && width <= 5000 && length >= 0.3 && length <= 5000)) fail(400, 'Width and length must be between 0.3 m (1 ft) and 5 km');
      Object.assign(map, { width, length });
      // Compass bearing the top edge of the map faces (null = not measured). Lets the phone compass set headings.
      map.topBearing = Number.isFinite(num(b.topBearing)) ? norm360(num(b.topBearing)) : null;
    } else {
      // Real-world map: the play area is a lat/lng box; north is up.
      const sw = latLng(b.bounds?.sw), ne = latLng(b.bounds?.ne);
      const valid = [sw.lat, sw.lng, ne.lat, ne.lng].every(Number.isFinite) && sw.lat < ne.lat && sw.lng < ne.lng
        && Math.abs(sw.lat) <= 85 && Math.abs(ne.lat) <= 85;
      if (!valid) fail(400, 'Invalid play area');
      map.bounds = { sw, ne };
      if (mapSpan(map) > 50_000) fail(400, 'Play area is too big (max 50 km across)');
      map.topBearing = 0;
      map.autoImportOsm = !!b.autoImportOsm;
    }
    map.features = (Array.isArray(b.features) ? b.features : []).slice(0, 400)
      .filter(f => isValidPos(map, f?.pos))
      .map(f => ({
        id: str(f.id, 30) || newId(),
        label: str(f.label, 60) || 'Feature',
        kind: FEATURE_KINDS.includes(f.kind) ? f.kind : 'custom',
        source: f.source === 'osm' ? 'osm' : 'user',
        pos: clampPos(map, type === 'latlng' ? latLng(f.pos) : { x: num(f.pos.x), y: num(f.pos.y) }),
      }));
    return map;
  }

  /** Replace a map's OpenStreetMap labels with fresh ones; labels you added yourself are kept. */
  async function importOsm(mapId) {
    const map = findMap(mapId);
    if (map.type !== 'latlng') fail(400, 'Only real-world maps can import from OpenStreetMap');
    let osm;
    try { osm = await fetchOsmFeatures(map.bounds); } catch (err) { fail(502, err.message); }
    const current = findMap(mapId); // may have been edited while we waited
    current.features = [...osm, ...current.features.filter(f => f.source !== 'osm')];
    current.osmImportedAt = new Date().toISOString();
    store.save();
    return { added: osm.length, map: current };
  }

  function cleanPose(map, b, what) {
    if (!isValidPos(map, b?.pos)) fail(400, `Place the ${what} position on the map`);
    const heading = num(b.heading);
    if (!Number.isFinite(heading)) fail(400, `Set the ${what} direction`);
    return { pos: clampPos(map, b.pos), heading: norm360(heading) };
  }

  async function api(req, res, p, method, url) {
    let m;
    if (p === '/api/info' && method === 'GET') {
      return send(res, 200, { ...info(), today: localDate() });
    }

    // ── maps ──
    if (p === '/api/maps') {
      if (method === 'GET') return send(res, 200, db.maps);
      if (method === 'POST') {
        const map = cleanMap(await readJson(req));
        db.maps.push(map);
        store.save();
        return send(res, 201, map);
      }
    }
    if ((m = p.match(/^\/api\/maps\/([\w-]+)$/))) {
      const map = findMap(m[1]);
      if (method === 'GET') return send(res, 200, map);
      if (method === 'PUT') {
        const next = cleanMap(await readJson(req), map);
        if (map.osmImportedAt) next.osmImportedAt = map.osmImportedAt;
        db.maps[db.maps.indexOf(map)] = next;
        store.save();
        return send(res, 200, next);
      }
    }

    if ((m = p.match(/^\/api\/maps\/([\w-]+)\/import-osm$/)) && method === 'POST') {
      return send(res, 200, await importOsm(m[1]));
    }

    // ── rounds ──
    if (p === '/api/rounds') {
      if (method === 'GET') {
        const list = [...db.rounds].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
        return send(res, 200, list.map(publicRound));
      }
      if (method === 'POST') {
        const b = await readJson(req);
        const map = findMap(b.mapId);
        const truth = cleanPose(map, b.truth, 'true');
        const difficulty = scoring.difficulties[b.difficulty] ? b.difficulty : fail(400, 'Pick a difficulty');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : localDate();
        const photo = decodePhoto(b.photo);
        const id = newId();
        const file = `${id}.${photo.ext}`;
        fs.writeFileSync(path.join(store.photosDir, file), photo.buf);
        const round = { id, mapId: map.id, title: str(b.title, 80), photo: file, truth, difficulty, date, createdAt: new Date().toISOString() };
        db.rounds.push(round);
        store.save();
        return send(res, 201, publicRound(round));
      }
    }
    if (p === '/api/rounds/today' && method === 'GET') {
      // One released round per day: the newest round dated today (the browser sends its own local date).
      const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date')) ? url.searchParams.get('date') : localDate();
      const round = db.rounds.filter(r => r.date === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return send(res, 200, { date, round: round ? publicRound(round) : null });
    }
    if ((m = p.match(/^\/api\/rounds\/([\w-]+)$/))) {
      const round = findRound(m[1]);
      if (method === 'GET') return send(res, 200, publicRound(round));
      if (method === 'DELETE') {
        db.rounds.splice(db.rounds.indexOf(round), 1);
        db.guesses = db.guesses.filter(g => g.roundId !== round.id);
        fs.rmSync(path.join(store.photosDir, path.basename(round.photo)), { force: true });
        store.save();
        return send(res, 200, { ok: true });
      }
    }

    // ── guesses ──
    if ((m = p.match(/^\/api\/rounds\/([\w-]+)\/guesses$/))) {
      const round = findRound(m[1]);
      const map = findMap(round.mapId);
      if (method === 'GET') {
        const guesses = guessesFor(round.id);
        // The answer is only revealed once at least one guess exists.
        return send(res, 200, { round: publicRound(round), map, truth: guesses.length ? round.truth : null, guesses });
      }
      if (method === 'POST') {
        const pose = cleanPose(map, await readJson(req), 'guessed');
        const result = scoreGuess({ map, truth: round.truth, guess: pose, difficulty: round.difficulty });
        const guess = { id: newId(), roundId: round.id, ...pose, ...result, createdAt: new Date().toISOString() };
        db.guesses.push(guess);
        store.save();
        return send(res, 201, { guess, truth: round.truth, round: publicRound(round), map });
      }
    }

    fail(404, 'Not found');
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { fail(400, 'Bad URL'); }
      if (p.startsWith('/api/')) return await api(req, res, p, req.method, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed');
      if (p.startsWith('/photos/') && serveFile(res, store.photosDir, p.slice('/photos/'.length), 'public, max-age=31536000, immutable')) return;
      if (p.startsWith('/shared/') && serveFile(res, SHARED_DIR, p.slice('/shared/'.length))) return;
      if (serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p)) return;
      fail(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Server error' });
    }
  }

  /** Called by server.js at startup: fetch building names for campus maps that have none yet. */
  handle.autoImportOsm = async (log = console.log) => {
    for (const map of db.maps.filter(m => m.type === 'latlng' && m.autoImportOsm && !m.features.some(f => f.source === 'osm'))) {
      try {
        const { added } = await importOsm(map.id);
        log(`  Loaded ${added} building/place names for "${map.name}" from OpenStreetMap.`);
      } catch (err) {
        log(`  Couldn't load building names for "${map.name}": ${err.message}. Will retry on next start (or Edit map → Import).`);
      }
    }
  };
  return handle;
}
