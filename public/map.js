// Route map: the loop drawn from the stops' real coordinates, with shuttle markers that glide between
// updates. No map tiles or libraries, so it works offline and inside the simulator.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  function create(config, { maxHeight = 230 } = {}) {
    const S = config.stops;
    const lat0 = S.reduce((a, s) => a + s.lat, 0) / S.length, kx = Math.cos(lat0 * Math.PI / 180);
    const xs = S.map(s => s.lng * kx), ys = S.map(s => -s.lat);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX || 1e-6, spanY = Math.max(...ys) - minY || 1e-6;
    const W = 400, padX = 112, padY = 30;
    const scale = Math.min((W - 2 * padX) / spanX, maxHeight / spanY);
    const H = Math.round(spanY * scale + 2 * padY), offX = (W - spanX * scale) / 2;
    const P = p => [offX + (p.lng * kx - minX) * scale, padY + (-p.lat - minY) * scale];
    const pts = S.map(P);

    const wrap = document.createElement('div');
    wrap.className = 'route-map';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Route map of ${S.length} stops` }, wrap);
    el('path', { class: 'route-line', d: 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L') + ' Z' }, svg);
    pts.forEach((p, i) => { // direction arrows at segment midpoints
      const q = pts[(i + 1) % pts.length], ang = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
      el('path', { class: 'route-arrow', d: 'M-3.5 -4 L2.5 0 L-3.5 4', transform: `translate(${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}) rotate(${ang.toFixed(0)})` }, svg);
    });
    const stopEls = S.map((s, i) => {
      const [x, y] = pts[i], g = el('g', { class: 'map-stop', 'data-id': s.id }, svg);
      el('circle', { class: 'stop-ring', cx: x, cy: y, r: 13 }, g);
      el('circle', { class: 'stop-dot', cx: x, cy: y, r: 6 }, g);
      const right = x < W / 2 + 1, t = el('text', { x: x + (right ? -20 : 20), y: y + 4, 'text-anchor': right ? 'end' : 'start' }, g);
      t.textContent = s.name;
      return g;
    });
    const ghostLayer = el('g', { class: 'ghosts' }, svg), busLayer = el('g', { class: 'buses' }, svg);
    const markers = new Map();

    function marker(layer, key, ghost, label) {
      let g = markers.get(key);
      if (!g) {
        g = el('g', { class: ghost ? 'ghost' : 'bus' }, layer);
        if (ghost) { el('circle', { r: 16 }, g); }
        else { el('rect', { x: -15, y: -10, width: 30, height: 20, rx: 6 }, g); }
        const t = el('text', { y: ghost ? -20 : 4.5, 'text-anchor': 'middle' }, g); t.textContent = label;
        el('title', {}, g);
        markers.set(key, g);
      }
      return g;
    }
    function place(g, p, offset) {
      const [x, y] = P(p);
      g.style.transform = `translate(${x.toFixed(1)}px, ${(y + offset).toFixed(1)}px)`;
    }

    // state: from the tracker. opts.highlight: stop id ("you are here"); opts.focus: shuttle id;
    // opts.ghosts: [{id, lat, lng}] real positions (simulator only)
    function update(state, opts = {}) {
      stopEls.forEach(g => g.classList.toggle('here', g.dataset.id === opts.highlight));
      const seen = new Set(), stacked = new Map();
      state.buses.forEach(b => {
        const g = marker(busLayer, 'bus:' + b.id, false, b.id);
        seen.add('bus:' + b.id);
        g.style.display = b.est ? '' : 'none';
        if (!b.est) return;
        const key = `${b.est.lat.toFixed(4)},${b.est.lng.toFixed(4)}`, n = stacked.get(key) || 0;
        stacked.set(key, n + 1);
        place(g, b.est, n * 22);
        g.classList.toggle('late', !!b.late);
        g.classList.toggle('dim', !!opts.focus && opts.focus !== b.id);
        g.querySelector('title').textContent = `${b.name}: estimated position${b.late ? ', behind schedule' : ''}`;
      });
      (opts.ghosts || []).forEach(p => {
        const g = marker(ghostLayer, 'ghost:' + p.id, true, p.id);
        seen.add('ghost:' + p.id);
        g.style.display = p.lat == null ? 'none' : '';
        if (p.lat != null) place(g, p, 0);
        g.querySelector('title').textContent = `Where ${p.id} really is`;
      });
      for (const [k, g] of markers) if (!seen.has(k)) g.style.display = 'none';
    }
    return { el: wrap, update };
  }

  root.ShuttleMap = { create };
})(typeof self !== 'undefined' ? self : this);
