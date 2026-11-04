// Single-page app: "/" = live board, "/s/<stop>" = stop QR page, "/b/<shuttle>" = on-board QR page.
const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let device;
try { device = localStorage.getItem('dev') || (localStorage.setItem('dev', crypto.randomUUID()), localStorage.getItem('dev')); }
catch { device = Math.random().toString(36).slice(2); }

let cfg, state, myPos = null, sharing = null;
const [, kind, param] = location.pathname.split('/');

function ago(t) {
  const m = Math.round(((state?.now ?? Date.now()) - t) / 60000); // server clock, avoids phone clock skew
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
function etaHtml(e) {
  if (!e) return '<div class="eta">—</div>';
  if (e.source === 'typical') return `<div class="eta typical">~${e.mins} min<div class="eta-src">usual time</div></div>`;
  return `<div class="eta ${e.mins === 0 ? 'now' : ''}">${e.mins === 0 ? 'Now' : `${e.mins} min`}</div>`;
}
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2));
}
function nearest() {
  if (!myPos) return null;
  return cfg.stops.map(s => ({ s, d: dist(myPos, s) })).sort((a, b) => a.d - b.d)[0];
}
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(el); setTimeout(() => el.remove(), 3000);
}
function locate() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => { myPos = { lat: p.coords.latitude, lng: p.coords.longitude }; res(myPos); },
      () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}
async function report(body, okMsg) {
  try {
    const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, device, ...(myPos || {}) }) });
    const j = await r.json();
    toast(r.ok ? (j.msg === 'ok' ? okMsg : 'Already counted — thanks!') : (j.error || 'Something went wrong'));
    await refresh();
  } catch { toast('Offline — try again'); }
}

async function refresh() {
  try { state = await (await fetch('/api/state')).json(); render(); } catch {}
}

function busLine(b) {
  if (!b.pos) return `<div class="muted small">${esc(b.name)}: no recent reports</div>`;
  const stop = cfg.stops.find(s => s.id === b.pos.stop);
  const how = b.pos.via === 'gps' ? 'near' : 'at';
  const who = b.pos.via === 'gps' ? 'rider location' : `${b.pos.reporters} report${b.pos.reporters > 1 ? 's' : ''}`;
  return `<div class="small"><b>${esc(b.name)}</b> was ${how} <b>${esc(stop.name)}</b> ${ago(b.pos.at)} <span class="muted">(${who})</span></div>`;
}
function stopCard(s, st, near) {
  const e = st.etas[0];
  return `<a class="card row" href="/s/${s.id}" style="color:inherit;text-decoration:none">
    <div><div class="stop-name">${esc(s.name)} ${near ? '<span class="pill near">nearest</span>' : ''}</div>
      <div class="muted small">${st.waiting ? `${st.waiting} waiting · ` : ''}${st.lastArrival ? `last seen ${ago(st.lastArrival)}` : 'no sightings yet'}</div></div>
    ${etaHtml(e)}</a>`;
}

function renderBoard() {
  const n = nearest();
  const anyLive = state.buses.some(b => b.pos);
  $app.innerHTML = `
    <div class="card">${state.buses.map(busLine).join('')}
      ${anyLive ? '' : '<div class="muted small" style="margin-top:6px">Be the first: scan the QR code at your stop or on the shuttle.</div>'}</div>
    ${myPos ? '' : '<button id="loc">📍 Find my nearest stop</button>'}
    <h2>Stops</h2>
    ${cfg.stops.map((s, i) => stopCard(s, state.stops[i], n && n.s.id === s.id)).join('')}
    <h2>Recent reports</h2>
    <div class="card small">${state.recent.length ? state.recent.map(r =>
      `<div>${ago(r.t)} · ${r.type === 'arrive' ? '🚌 shuttle at' : '🙋 someone waiting at'} ${esc(cfg.stops.find(s => s.id === r.stop)?.name || r.stop)}</div>`).join('')
      : '<span class="muted">Nothing yet today.</span>'}</div>`;
  document.getElementById('loc')?.addEventListener('click', async () => { if (!await locate()) toast('Location unavailable'); render(); });
}

function busPicker(id) {
  if (cfg.shuttles.length < 2) return '';
  return `<label class="small muted">Which shuttle?</label>
    <select id="${id}">${cfg.shuttles.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>`;
}

function renderStop() {
  const i = cfg.stops.findIndex(s => s.id === param);
  if (i < 0) { $app.innerHTML = '<p>Unknown stop. <a href="/">See all stops</a></p>'; return; }
  const s = cfg.stops[i], st = state.stops[i], e = st.etas[0];
  $app.innerHTML = `
    <div class="muted small">You're at</div>
    <h1>${esc(s.name)}</h1>
    <div class="card row"><div><div class="muted small">Next shuttle (estimate)</div>
      ${state.buses.map(busLine).join('')}
      ${e?.source === 'typical' ? `<div class="muted small">No live reports — estimate from the last ${e.days} days</div>` : ''}</div>
      ${etaHtml(e)}</div>
    <div class="muted small" style="margin:-4px 0 8px">${st.waiting} ${st.waiting === 1 ? 'person' : 'people'} waiting here</div>
    <button class="primary" id="arrive">🚌 The shuttle is here</button>
    <button id="wait">🙋 I'm waiting</button>
    ${busPicker('bus')}
    <a class="btn" href="/">See all stops</a>`;
  const bus = () => document.getElementById('bus')?.value;
  document.getElementById('arrive').onclick = () => report({ type: 'arrive', stop: s.id, bus: bus() }, 'Thanks! Everyone can see it now.');
  document.getElementById('wait').onclick = () => report({ type: 'wait', stop: s.id }, 'Got it — you\'re counted as waiting.');
}

function renderBus() {
  const b = cfg.shuttles.find(x => x.id === param);
  if (!b) { $app.innerHTML = '<p>Unknown shuttle. <a href="/">Home</a></p>'; return; }
  const n = nearest();
  $app.innerHTML = `
    <div class="muted small">You're riding</div>
    <h1>${esc(b.name)}</h1>
    <div class="card">${busLine(state.buses.find(x => x.id === b.id))}</div>
    <h2>Where are we?</h2>
    <p class="small muted" style="margin-top:0">Tap a stop when the shuttle pulls in.</p>
    ${cfg.stops.map(s => `<button data-stop="${s.id}" class="${n && n.s.id === s.id && n.d < 400 ? 'primary' : ''}">${esc(s.name)}</button>`).join('')}
    <h2>Hands-free</h2>
    <button id="share">${sharing ? '⏹ Stop sharing my location' : '📡 Share my location while I ride'}</button>
    <p class="small muted">Your phone sends its position every ~30 s for up to 30 min (only while this page is open). Only the nearest stop is shown to others.</p>`;
  $app.querySelectorAll('[data-stop]').forEach(btn => btn.onclick = () =>
    report({ type: 'arrive', stop: btn.dataset.stop, bus: b.id }, 'Thanks! Position updated.'));
  document.getElementById('share').onclick = () => {
    if (sharing) { stopSharing(); render(); return; }
    if (!navigator.geolocation) return toast('Location unavailable');
    const started = Date.now(); let last = 0;
    sharing = navigator.geolocation.watchPosition(p => {
      myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (Date.now() - started > 30 * 60000) { stopSharing(); render(); return; }
      if (Date.now() - last < 30000) return;
      last = Date.now();
      fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'gps', bus: b.id, device, ...myPos }) }).catch(() => {});
    }, () => { toast('Location permission denied'); stopSharing(); render(); }, { enableHighAccuracy: true });
    toast('Sharing location — keep this page open');
    render();
  };
}
function stopSharing() { if (sharing != null) navigator.geolocation.clearWatch(sharing); sharing = null; }

function render() {
  if (!cfg || !state) return;
  if (kind === 's') renderStop(); else if (kind === 'b') renderBus(); else renderBoard();
}

(async () => {
  cfg = await (await fetch('/api/config')).json();
  document.title = cfg.title; document.getElementById('title').textContent = cfg.title;
  await refresh();
  if (kind === 'b') locate().then(render); // pre-highlight the stop we're at
  setInterval(refresh, 15000);
})();
