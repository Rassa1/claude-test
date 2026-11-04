// The rider app. Three views, picked by which QR code was scanned:
//   /s/<stop>    the stop's own code: next shuttle, "it's here", "I'm waiting"
//   /b/<shuttle> the code inside a shuttle: tap the stop it's at, or share location hands-free
//   /            all stops (linked from the other two)
// mountApp() takes an `api`, so the simulator can run the same UI against an in-browser tracker.
(function (root) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mountApp(rootEl, { api, route, device, refreshMs = 15000, onNavigate }) {
    let cfg, state, map, sharing = null, lastHtml = '', timeFmt;
    rootEl.classList.add('shuttle-app');

    const stopName = id => cfg.stops.find(s => s.id === id)?.name || id;
    const busName = id => cfg.shuttles.find(b => b.id === id)?.name || id;
    const ago = t => { const m = Math.round((state.now - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
    const clock = t => timeFmt.format(t);

    function toast(msg) {
      rootEl.querySelector('.toast')?.remove();
      const n = Object.assign(document.createElement('div'), { className: 'toast', role: 'status', textContent: msg });
      rootEl.append(n); setTimeout(() => n.remove(), 2800);
    }
    async function report(body, okMsg) {
      try {
        const r = await api.report({ ...body, device, k: route.k });
        toast(r.ok ? (r.msg === 'ok' ? okMsg : 'Already counted. Thanks!') : r.error || 'That didn’t go through. Try again.');
        await refresh();
      } catch { toast('You’re offline. Try again in a moment.'); }
    }

    // ---- pieces ----
    function eta(e) {
      if (!e) return '<div class="eta"><span class="eta-num">—</span><span class="eta-sub">no estimate</span></div>';
      const live = e.source === 'live';
      const cls = !live ? 'approx' : e.late ? 'late' : e.mins === 0 ? 'now' : '';
      const num = live && e.mins === 0 ? 'Now' : `${live ? '' : '~'}${e.mins}<small> min</small>`;
      const sub = e.source === 'typical' ? 'usual time' : e.source === 'schedule' ? 'timetable'
        : e.late ? `Behind schedule${e.lateBy ? ` · +${e.lateBy}` : ''}`
        : e.mins === 0 && e.departs ? `leaves ${clock(e.departs)}` : e.lateBy != null ? 'on time' : 'live';
      return `<div class="eta ${cls}"><span class="eta-num">${num}</span><span class="eta-sub">${sub}</span></div>`;
    }
    function busStatus(b) {
      if (!b.pos) return `<div class="bus-status"><b>${esc(b.name)}</b> <span class="muted">· no reports lately</span></div>`;
      const where = b.est?.atStop ? `at ${esc(stopName(b.est.stop))}` : b.est?.to ? `heading to ${esc(stopName(b.est.to))}` : `last at ${esc(stopName(b.pos.stop))}`;
      const flag = b.late ? `<span class="pill late">Behind schedule${b.lateBy ? ` · +${b.lateBy} min` : ''}</span>`
        : b.lateBy != null ? '<span class="pill ok">On time</span>' : '';
      const who = b.pos.via === 'gps' ? 'rider location' : `${b.pos.reporters} report${b.pos.reporters > 1 ? 's' : ''}`;
      return `<div class="bus-status"><div><b>${esc(b.name)}</b> ${where} ${flag}</div>
        <div class="muted small">Last report ${ago(b.pos.at)} · ${who}</div></div>`;
    }
    const navLink = (to, label, cls = '') => `<a class="${cls}" href="${to === 'board' ? '/' : '/s/' + to}" data-nav="${to}">${label}</a>`;
    const legend = '<p class="map-legend small muted">Shuttle positions are estimated from rider reports.</p>';

    // ---- views ----
    function board() {
      return `
        <section class="stack">${state.buses.map(busStatus).join('')}</section>
        <div class="map-slot"></div>${legend}
        <h2>Stops</h2>
        <ul class="stop-list">${cfg.stops.map((s, i) => {
          const st = state.stops[i];
          return `<li>${navLink(s.id, `<span><span class="stop-name">${esc(s.name)}</span>
            <span class="muted small">${st.waiting ? `${st.waiting} waiting · ` : ''}${st.lastArrival ? `shuttle ${ago(st.lastArrival)}` : 'no sightings yet'}</span></span>${eta(st.etas[0])}`, 'stop-row')}</li>`;
        }).join('')}</ul>
        <h2>Recent reports</h2>
        <ul class="feed small">${state.recent.length ? state.recent.map(r => `<li><span class="muted">${clock(r.t)}</span>
          ${r.type === 'arrive' ? `${esc(busName(r.bus))} at` : 'Someone waiting at'} ${esc(stopName(r.stop))}</li>`).join('') : '<li class="muted">Nothing yet today.</li>'}</ul>`;
    }

    function stopView() {
      const i = cfg.stops.findIndex(s => s.id === route.id);
      if (i < 0) return `<p>This QR code doesn’t match a stop. ${navLink('board', 'See all stops')}</p>`;
      const s = cfg.stops[i], st = state.stops[i], [e, then] = st.etas;
      const forBus = e?.bus ? busName(e.bus) : 'Next shuttle';
      const note = e?.source === 'typical' ? `No live reports yet. Based on the last ${e.days} days.`
        : e?.source === 'schedule' ? 'No live reports yet. From the timetable.'
        : e?.late ? `Running ${e.lateBy ? `${e.lateBy} min ` : ''}behind schedule.` : '';
      return `
        <p class="eyebrow">You’re at</p>
        <h1>${esc(s.name)}</h1>
        <section class="eta-card ${e?.late ? 'is-late' : ''}">
          <div><div class="small muted">${esc(e?.source === 'typical' ? 'Next shuttle' : forBus)}</div>
            ${note ? `<div class="note">${esc(note)}</div>` : ''}
            ${then ? `<div class="small muted">Then ${esc(then.bus ? busName(then.bus) : 'another')} in ${then.mins} min</div>` : ''}</div>
          ${eta(e)}
        </section>
        <div class="actions">
          ${cfg.shuttles.map(b => `<button class="btn primary" data-act="arrive" data-bus="${b.id}">${cfg.shuttles.length > 1 ? `${esc(b.name)} is here` : 'The shuttle is here'}</button>`).join('')}
          <button class="btn" data-act="wait">I’m waiting${st.waiting ? ` <span class="count">${st.waiting} here</span>` : ''}</button>
        </div>
        <div class="map-slot"></div>${legend}
        <p class="small">${navLink('board', 'All stops and shuttles')}</p>`;
    }

    function busView() {
      const b = state.buses.find(x => x.id === route.id);
      if (!b) return `<p>This QR code doesn’t match a shuttle. ${navLink('board', 'See all stops')}</p>`;
      const next = b.next;
      const others = cfg.stops.filter(s => s.id !== next);
      const stopBtn = (s, cls) => `<button class="btn ${cls}" data-act="here" data-stop="${s.id}">${cls ? 'We’re at ' : ''}${esc(s.name)}</button>`;
      return `
        <p class="eyebrow">You’re riding</p>
        <h1>${esc(b.name)}</h1>
        ${busStatus(b)}
        <h2>When the shuttle pulls in</h2>
        ${next ? `<div class="actions">${stopBtn(cfg.stops.find(s => s.id === next), 'primary')}</div>
          <details class="other-stops"><summary>At a different stop?</summary><div class="actions">${others.map(s => stopBtn(s, '')).join('')}</div></details>`
          : `<div class="actions">${cfg.stops.map(s => stopBtn(s, '')).join('')}</div>`}
        <div class="map-slot"></div>${legend}
        <h2>Hands-free</h2>
        <button class="btn" data-act="share">${sharing ? 'Stop sharing my location' : 'Share my location while I ride'}</button>
        <p class="small muted">Sends your position every 30 seconds for up to 30 minutes while this page is open. Others only see the shuttle’s position.</p>`;
    }

    function render() {
      if (!cfg || !state) return;
      const html = route.kind === 's' ? stopView() : route.kind === 'b' ? busView() : board();
      if (html !== lastHtml) {
        const open = rootEl.querySelector('details')?.open;
        rootEl.querySelector('.views')?.remove();
        const v = document.createElement('div'); v.className = 'views'; v.innerHTML = html;
        rootEl.prepend(v); lastHtml = html;
        if (open && v.querySelector('details')) v.querySelector('details').open = true;
        v.querySelector('.map-slot')?.append(map.el);
      }
      map.update(state, { highlight: route.kind === 's' ? route.id : null, focus: route.kind === 'b' ? route.id : null });
    }
    async function refresh() { try { state = await api.state(); render(); } catch {} }

    function stopSharing() { if (sharing != null) api.geo.clear(sharing); sharing = null; }
    rootEl.addEventListener('click', ev => {
      const nav = ev.target.closest('[data-nav]');
      if (nav && onNavigate) { ev.preventDefault(); onNavigate(nav.dataset.nav); return; }
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'arrive') report({ type: 'arrive', stop: route.id, bus: btn.dataset.bus }, 'Thanks! Everyone can see it now.');
      if (act === 'wait') report({ type: 'wait', stop: route.id }, 'Got it. You’re counted as waiting.');
      if (act === 'here') report({ type: 'arrive', stop: btn.dataset.stop, bus: route.id }, `Thanks! Marked at ${stopName(btn.dataset.stop)}.`);
      if (act === 'share') {
        if (sharing != null) { stopSharing(); lastHtml = ''; render(); return; }
        const started = state.now; let last = 0;
        sharing = api.geo.watch(p => {
          if (state.now - started > 30 * 60000) { stopSharing(); lastHtml = ''; render(); return; }
          if (state.now - last < 30000) return;
          last = state.now;
          api.report({ type: 'gps', bus: route.id, device, k: route.k, lat: p.lat, lng: p.lng }).catch(() => {});
        }, () => { toast('Location is off for this site. Turn it on in your browser settings.'); stopSharing(); lastHtml = ''; render(); });
        toast('Sharing location. Keep this page open.');
        lastHtml = ''; render();
      }
    });

    (async () => {
      cfg = await api.config();
      timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: cfg.timezone || undefined });
      map = root.ShuttleMap.create(cfg);
      await refresh();
      if (refreshMs) setInterval(refresh, refreshMs);
    })();
    return { refresh, setRoute(r) { route = r; stopSharing(); lastHtml = ''; render(); } };
  }

  // ---- the real site ----
  const httpApi = {
    config: () => fetch('/api/config').then(r => r.json()),
    state: () => fetch('/api/state').then(r => r.json()),
    report: body => fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => ({ ok: r.ok, ...(await r.json()) })),
    geo: {
      watch: (cb, err) => navigator.geolocation ? navigator.geolocation.watchPosition(p => cb({ lat: p.coords.latitude, lng: p.coords.longitude }), err, { enableHighAccuracy: true }) : (err(), null),
      clear: id => navigator.geolocation?.clearWatch(id),
    },
  };
  function boot() {
    const host = document.getElementById('app');
    if (!host || root.SHUTTLE_NO_AUTOBOOT) return;
    const [, kind, id] = location.pathname.split('/');
    const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
    let k = new URLSearchParams(location.search).get('k');
    if (k) store.set('k:' + location.pathname, k); else k = store.get('k:' + location.pathname);
    let device = store.get('dev');
    if (!device) { device = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); store.set('dev', device); }
    httpApi.config().then(c => { document.title = c.title; const h = document.getElementById('title'); if (h) h.textContent = c.title; });
    mountApp(host, { api: httpApi, route: { kind, id: id && decodeURIComponent(id), k }, device });
  }
  root.ShuttleApp = { mountApp };
  if (typeof document !== 'undefined') document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})(window);
