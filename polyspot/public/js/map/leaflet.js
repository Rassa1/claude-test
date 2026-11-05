// Real-world map adapter (Leaflet): overhead satellite imagery or a street map. Positions are { lat, lng };
// headings are compass bearings (0 = north, which is up). See ./index.js for the interface.
// Map tiles load from the internet (Esri imagery, OpenStreetMap); everything else stays local.
import { bearing, clampPos } from '/shared/geo.js';
import { h } from '../ui.js';

const CONE_HALF_ANGLE = 30;
const EARTH_R = 6371008.8;
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const ll = p => [p.lat, p.lng];

const TILES = {
  Satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  Map: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

/** Point `meters` away from p along compass bearing `brg`. */
function destination(p, brg, meters) {
  const δ = meters / EARTH_R, θ = rad(brg), φ1 = rad(p.lat), λ1 = rad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lng: deg(λ2) };
}

/** Leaflet draws with SVG attributes, which can't use CSS variables: resolve "var(--x)" to a color. */
function cssColor(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(c || '');
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#ff9f1c' : c;
}

export function createLeafletView(container, initialMap) {
  const L = window.L;
  if (!L) throw new Error('The map library did not load. Refresh the page.');
  const el = h('div', { class: 'leaflet-host' });
  container.append(el);

  const lmap = L.map(el, { doubleClickZoom: false, zoomSnap: 0.5, minZoom: 13, maxZoom: 21 });
  el.style.position = 'absolute'; // Leaflet sets 'relative' when created before the element is on the page
  lmap.attributionControl.setPrefix(false);
  const bases = Object.fromEntries(Object.entries(TILES).map(([name, t]) =>
    [name, L.tileLayer(t.url, { attribution: t.attribution, maxNativeZoom: 19, maxZoom: 21 })]));
  bases.Satellite.addTo(lmap);
  const areaLayer = L.layerGroup().addTo(lmap);
  const labelLayer = L.layerGroup().addTo(lmap);
  const lineLayer = L.layerGroup().addTo(lmap);
  const poseLayer = L.layerGroup().addTo(lmap);
  const editLayer = L.layerGroup().addTo(lmap);
  L.control.layers(bases, { 'Building labels': labelLayer }, { position: 'topleft' }).addTo(lmap);

  let destroyed = false, map, scaleCtl = null, poses = [], lines = [], editor = null, picker = null, fitted = false, focusOn = null;

  // Arrow and cone sizes are in screen pixels, converted to meters at the current zoom.
  const metersPerPx = () => (40075016.686 * Math.cos(rad(lmap.getCenter().lat))) / 2 ** (lmap.getZoom() + 8);
  const sizes = () => { const m = metersPerPx(); return { cone: 95 * m, arm: 56 * m, head: 13 * m }; };
  const clamp = latlng => clampPos(map, { lat: latlng.lat, lng: latlng.lng });

  function drawShapes(layer, { pos, heading, color }) {
    const c = cssColor(color), { cone, arm, head } = sizes();
    const arc = [];
    for (let a = -CONE_HALF_ANGLE; a <= CONE_HALF_ANGLE; a += 5) arc.push(ll(destination(pos, heading + a, cone)));
    L.polygon([ll(pos), ...arc], { color: c, weight: 1, opacity: 0.9, fillColor: c, fillOpacity: 0.28, interactive: false }).addTo(layer);
    const tip = destination(pos, heading, arm);
    L.polyline([ll(pos), ll(tip)], { color: c, weight: 4, interactive: false }).addTo(layer);
    const point = destination(pos, heading, arm + head);
    const left = destination(tip, heading - 90, head * 0.6), right = destination(tip, heading + 90, head * 0.6);
    L.polygon([ll(point), ll(left), ll(right)], { color: c, weight: 1, fillColor: c, fillOpacity: 1, interactive: false }).addTo(layer);
  }

  function label(layer, text, color, side) {
    const tip = L.tooltip({ permanent: true, direction: side === 'left' ? 'left' : 'right', offset: [side === 'left' ? -10 : 10, 0], className: 'pose-tip', interactive: false });
    tip.setContent(text);
    tip.setLatLng(layer.getLatLng());
    return tip;
  }

  function drawPoses() {
    poseLayer.clearLayers();
    for (const p of poses) {
      if (!p.pos) continue;
      if (p.heading != null) drawShapes(poseLayer, p);
      const dot = L.circleMarker(ll(p.pos), { radius: 8, color: '#fff', weight: 3, fillColor: cssColor(p.color), fillOpacity: 1, interactive: false }).addTo(poseLayer);
      if (p.label) label(dot, p.label, p.color, p.labelSide).addTo(poseLayer).getElement().style.color = cssColor(p.color);
    }
  }

  function drawLines() {
    lineLayer.clearLayers();
    for (const l of lines) L.polyline([ll(l.a), ll(l.b)], { color: cssColor(l.color) || '#fff', weight: 3, dashArray: '8 7', interactive: false }).addTo(lineLayer);
  }

  function drawLabels() {
    labelLayer.clearLayers();
    for (const f of map.features || []) {
      L.circleMarker(ll(f.pos), { radius: 3.5, color: '#fff', weight: 1.5, fillColor: f.kind === 'parking' ? '#3b82f6' : '#111', fillOpacity: 1, interactive: false })
        .bindTooltip(f.label, { permanent: true, direction: 'top', offset: [0, -4], className: `feat-tip kind-${f.kind || 'custom'}` })
        .addTo(labelLayer);
    }
  }

  // Building labels: none when zoomed far out, buildings only in between, everything up close.
  function updateLabelDensity() {
    const z = lmap.getZoom();
    el.classList.toggle('labels-none', z < 15.5);
    el.classList.toggle('labels-buildings', z >= 15.5 && z < 17.5);
  }

  // ── editing: tap to place, drag the dot to move, drag the white ring to aim ──
  function emit() { editor.onChange?.({ ...editor.state }); }

  function renderEditor() {
    const ed = editor;
    if (!ed) return;
    ed.shapes.clearLayers();
    if (!ed.state.pos) return;
    drawShapes(ed.shapes, { ...ed.state, color: ed.color });
    const c = cssColor(ed.color);
    const tipLL = ll(destination(ed.state.pos, ed.state.heading, sizes().arm));
    if (!ed.dot) {
      ed.dot = L.marker(ll(ed.state.pos), {
        draggable: true, keyboard: false, autoPan: true,
        icon: L.divIcon({ className: 'lf-marker', html: `<div class="lf-dot" style="--c:${c}"></div>`, iconSize: [26, 26] }),
      }).addTo(editLayer);
      if (ed.label) ed.dot.bindTooltip(ed.label, { permanent: true, direction: 'right', offset: [12, 0], className: 'pose-tip' }).openTooltip();
      ed.dot.getTooltip()?.getElement()?.style.setProperty('color', c);
      ed.dot.on('drag', e => { ed.dragging = 'dot'; ed.state.pos = clamp(e.latlng); renderEditor(); emit(); });
      ed.dot.on('dragend', () => { ed.dragging = null; renderEditor(); });
      ed.handle = L.marker(tipLL, {
        draggable: true, keyboard: false, autoPan: true,
        icon: L.divIcon({ className: 'lf-marker', html: `<div class="lf-handle" style="--c:${c}"></div>`, iconSize: [34, 34] }),
      }).addTo(editLayer);
      ed.handle.on('drag', e => {
        ed.dragging = 'handle';
        ed.state.heading = Math.round(bearing(map, ed.state.pos, { lat: e.latlng.lat, lng: e.latlng.lng }));
        renderEditor();
        emit();
      });
      ed.handle.on('dragend', () => { ed.dragging = null; renderEditor(); });
    }
    if (ed.dragging !== 'dot') ed.dot.setLatLng(ll(ed.state.pos));
    if (ed.dragging !== 'handle') ed.handle.setLatLng(tipLL);
  }

  lmap.on('click', e => {
    if (picker) {
      const cb = picker;
      stopEditing();
      return cb(clamp(e.latlng));
    }
    if (editor) {
      editor.state.pos = clamp(e.latlng);
      renderEditor();
      emit();
    }
  });
  lmap.on('zoomend', () => { updateLabelDensity(); drawPoses(); renderEditor(); });

  function stopEditing() {
    editor = null;
    picker = null;
    editLayer.clearLayers();
    el.classList.remove('picking');
  }

  // Leaflet needs a visible, sized container; the play view starts with the map hidden.
  function fit() {
    if (!el.clientWidth || !el.clientHeight) return;
    lmap.invalidateSize();
    if (focusOn?.length) lmap.fitBounds(L.latLngBounds(focusOn.map(ll)).pad(0.6), { maxZoom: 19 });
    else lmap.fitBounds(L.latLngBounds(ll(map.bounds.sw), ll(map.bounds.ne)));
    fitted = true;
  }
  const ro = new ResizeObserver(() => {
    if (!el.clientWidth) return;
    lmap.invalidateSize();
    if (!fitted) fit();
  });
  ro.observe(el);

  function setMap(next) {
    const first = !map;
    map = next;
    const b = L.latLngBounds(ll(map.bounds.sw), ll(map.bounds.ne));
    if (first) lmap.setView(b.getCenter(), 16);
    lmap.setMaxBounds(b.pad(0.6));
    areaLayer.clearLayers();
    L.rectangle(b, { color: '#ffffff', weight: 2, opacity: 0.7, dashArray: '6 6', fill: false, interactive: false }).addTo(areaLayer);
    scaleCtl?.remove();
    scaleCtl = L.control.scale({ imperial: map.units !== 'm', metric: map.units === 'm', position: 'bottomleft' }).addTo(lmap);
    drawLabels();
    updateLabelDensity();
    drawPoses();
    renderEditor();
    if (first) fit();
  }
  setMap(initialMap);

  return {
    hints: {
      place: 'Pinch to zoom. Tap the spot where the photo was taken.',
      adjust: 'Drag the white ring to aim, or the dot to move. Then submit.',
    },
    setMap,
    setPoses(list) { poses = list || []; drawPoses(); },
    setLines(list) { lines = list || []; drawLines(); },
    focus(positions) { focusOn = positions; fitted = false; fit(); },
    currentBounds() {
      const b = lmap.getBounds();
      return { sw: { lat: b.getSouth(), lng: b.getWest() }, ne: { lat: b.getNorth(), lng: b.getEast() } };
    },
    editPose({ value, color = 'var(--guess)', label: text = '', onChange } = {}) {
      stopEditing();
      editor = { state: { pos: value?.pos ?? null, heading: value?.heading ?? 0 }, color, label: text, onChange, shapes: L.layerGroup().addTo(editLayer) };
      renderEditor();
      return {
        set(partial) { if (editor) { Object.assign(editor.state, partial); renderEditor(); } },
        get: () => (editor ? { ...editor.state } : null),
        stop: stopEditing,
      };
    },
    pickPoint(onPick) {
      stopEditing();
      picker = onPick;
      el.classList.add('picking');
    },
    stopEditing,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ro.disconnect();
      lmap.remove();
      el.remove();
    },
  };
}
