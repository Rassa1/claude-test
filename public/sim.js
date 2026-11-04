// Interactive simulator: runs core.js + world.js in the browser and mounts the real app (app.js) in two
// phone frames, so you can tap through it while simulated shuttles and students go about their morning.
(function () {
  const { createTracker, MIN } = window.ShuttleCore;
  const { createWorld, summarize } = window.ShuttleWorld;
  const config = window.SHUTTLE_CONFIG;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: config.timezone || undefined });

  const sim = { tracker: null, world: null, clock: { t: 0 }, target: 0, speed: 30, playing: true, ghosts: true };
  const advance = t => { sim.target = Math.max(sim.target, t); sim.world.runUntil(sim.target); };

  // first timetable departure of the day (in the school's timezone), minus 10 minutes
  function dayStart(tracker, dayOffset) {
    const ref = Date.now() + dayOffset * 24 * 60 * MIN;
    const firsts = config.shuttles.map(b => tracker.schedTimes(b.id, 0, ref)[0]).filter(x => x != null);
    return (firsts.length ? Math.min(...firsts) : ref) - 10 * MIN;
  }

  function start(withHistory) {
    const clock = sim.clock;
    const tracker = createTracker(config, { now: () => clock.t });
    if (withHistory) for (let d = -10; d < 0; d++) { // 10 earlier mornings, so "usual time" has data
      tracker.reset();
      const s = dayStart(tracker, d), w = createWorld({ tracker, clock, start: s, seed: 1000 + d });
      w.runUntil(s + 5 * 60 * MIN, false);
    }
    tracker.reset();
    const s = dayStart(tracker, 0);
    const world = createWorld({ tracker, clock, start: s, seed: Math.floor(Math.random() * 1e6), opts: readOpts() });
    sim.tracker = tracker; sim.world = world;
    $('log').innerHTML = '';
    world.onLog(addLog);
    addLog({ t: clock.t, text: withHistory ? 'Morning starts. The app has 10 days of past data.' : 'Morning starts. The app has no past data.', kind: 'info' });
    sim.target = 0; advance(s + 14 * MIN); // open on a morning already in motion
    phones.forEach(p => p.app.setRoute(p.route()));
    draw(true);
  }

  // ---- controls ----
  function readOpts() {
    const tap = +$('tap').value / 100, gps = +$('gps').value / 100;
    return { hereTap: tap, waitTap: Math.min(1, tap * 1.3), rideTap: tap / 3, gpsShare: gps };
  }
  function syncOpts() {
    $('tapOut').textContent = $('tap').value + '%';
    $('gpsOut').textContent = $('gps').value + '%';
    if (sim.world) Object.assign(sim.world.opts, readOpts());
  }
  $('tap').addEventListener('input', syncOpts);
  $('gps').addEventListener('input', syncOpts);
  $('play').addEventListener('click', () => { sim.playing = !sim.playing; $('play').textContent = sim.playing ? 'Pause' : 'Play'; $('play').setAttribute('aria-pressed', String(!sim.playing)); });
  document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    sim.speed = +b.dataset.speed;
    document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('skip').addEventListener('click', () => { advance(sim.target + 15 * MIN); draw(true); });
  $('prank').addEventListener('click', () => { sim.world.prank(false); draw(true); });
  $('ghosts').addEventListener('change', e => { sim.ghosts = e.target.checked; draw(true); });
  $('restart').addEventListener('click', () => start($('history').checked));
  const jams = $('jams');
  jams.innerHTML = config.shuttles.map(b => `<button class="cbtn" data-jam="${b.id}">Traffic jam: ${esc(b.name)} +10 min</button>`).join('');
  jams.addEventListener('click', e => { const b = e.target.closest('[data-jam]'); if (b) { sim.world.jam(b.dataset.jam, 10); draw(true); } });

  // ---- log ----
  function addLog(x) {
    const li = document.createElement('li');
    li.className = 'k-' + x.kind;
    li.innerHTML = `<time>${timeFmt.format(x.t)}</time><span>${esc(x.text)}</span>`;
    const log = $('log'); log.prepend(li);
    while (log.children.length > 60) log.lastChild.remove();
  }

  // ---- phones running the real app ----
  const phoneApi = who => ({
    config: async () => config,
    state: async () => sim.tracker.buildState(),
    report: async body => {
      const [code, msg] = sim.tracker.handleReport(body, 'phone-' + who);
      const what = body.type === 'wait' ? `waiting at ${name(body.stop)}` : `${busName(body.bus)} at ${name(body.stop)}`;
      if (body.type !== 'gps') addLog({ t: sim.clock.t, text: `You reported ${what}${code === 200 ? '' : ` (rejected: ${msg})`}`, kind: 'you' });
      return code === 200 ? { ok: true, msg } : { ok: false, error: msg };
    },
    geo: { // the phone inside a shuttle moves with that shuttle
      watch: cb => setInterval(() => { const b = sim.world.buses.find(x => x.id === $('busPick').value); const p = b && sim.world.positionOf(b); if (p) cb(p); }, 300),
      clear: id => clearInterval(id),
    },
  });
  const name = id => config.stops.find(s => s.id === id)?.name || id;
  const busName = id => config.shuttles.find(b => b.id === id)?.name || id;
  $('stopPick').innerHTML = config.stops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('busPick').innerHTML = config.shuttles.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  $('stopPick').value = config.stops[1]?.id || config.stops[0].id;
  const phones = [
    { el: $('phoneStop'), who: 'stop', route: () => ({ kind: 's', id: $('stopPick').value }) },
    { el: $('phoneBus'), who: 'bus', route: () => ({ kind: 'b', id: $('busPick').value }) },
  ];
  phones.forEach(p => {
    p.app = window.ShuttleApp.mountApp(p.el, {
      api: phoneApi(p.who), route: p.route(), device: 'you-' + p.who, refreshMs: 0,
      onNavigate: to => p.app.setRoute(to === 'board' ? { kind: '' } : { kind: 's', id: to }),
    });
  });
  $('stopPick').addEventListener('change', () => phones[0].app.setRoute(phones[0].route()));
  $('busPick').addEventListener('change', () => phones[1].app.setRoute(phones[1].route()));

  // ---- big map + scoreboard ----
  const bigMap = window.ShuttleMap.create(config, { maxHeight: 300 });
  $('bigmap').append(bigMap.el);
  let lastDraw = 0;
  function draw(force) {
    const now = performance.now();
    if (!force && now - lastDraw < 250) return;
    lastDraw = now;
    const st = sim.tracker.buildState();
    $('clock').textContent = timeFmt.format(sim.target);
    bigMap.update(st, { ghosts: sim.ghosts ? sim.world.buses.map(b => ({ id: b.id, ...(sim.world.positionOf(b, sim.target) || { lat: null }) })) : [] });
    phones.forEach(p => p.app.refresh());
    $('fleet').innerHTML = st.buses.map(b => {
      const real = sim.world.buses.find(x => x.id === b.id);
      const realWhere = real.mode === 'stop' ? `at ${name(config.stops[real.k].id)}` : real.mode === 'drive' ? `driving to ${name(config.stops[real.k].id)}` : real.mode === 'done' ? 'done for the day' : 'not started';
      const said = !b.pos ? 'no reports yet' : b.late ? `<b class="late">behind schedule${b.lateBy ? ` +${b.lateBy} min` : ''}</b>` : b.lateBy != null ? 'on time' : 'tracking';
      return `<li><b>${esc(b.name)}</b><span>Really ${realWhere}</span><span>App says: ${said}</span></li>`;
    }).join('');
    const s = summarize(sim.world.score);
    const v = (x, unit = '%') => (x == null ? '—' : `${typeof x === 'number' && unit === ' min' ? x.toFixed(1) : x}${unit}`);
    $('s-median').textContent = v(s.median, ' min');
    $('s-within').textContent = v(s.within2);
    $('s-caught').textContent = s.lateCases ? v(s.lateCaught) : '—';
    $('s-false').textContent = s.lateCases || s.falseLate ? v(s.falseLate) : '—';
  }

  // ---- loop ----
  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(250, now - prev); prev = now;
    if (sim.playing) { advance(sim.target + dt * sim.speed); draw(false); }
    requestAnimationFrame(frame);
  }
  syncOpts();
  start(true);
  requestAnimationFrame(frame);
})();
