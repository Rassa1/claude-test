// Floor-plan map adapter: draws a rectangle to scale in SVG. Positions are { x, y } meters from the
// top-left corner. See ./index.js for the interface every adapter implements.
import { bearing, clampPos, distance, mapSpan } from '/shared/geo.js';
import { formatLength, gridStep } from '../units.js';

const NS = 'http://www.w3.org/2000/svg';
const CONE_HALF_ANGLE = 30; // degrees each side: roughly a phone camera's horizontal field of view
const HIT_PX = 30; // touch target radius for the marker and the aim handle

const rad = d => (d * Math.PI) / 180;
const dirVec = h => ({ x: Math.sin(rad(h)), y: -Math.cos(rad(h)) });
const along = (p, h, len) => { const v = dirVec(h); return { x: p.x + v.x * len, y: p.y + v.y * len }; };
const f = n => +n.toFixed(4);

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  // text halo: sized from the font so it scales with the map (SVG units here are meters, not pixels)
  if (tag === 'text' && attrs['font-size']) e.setAttribute('stroke-width', f(attrs['font-size'] * 0.22));
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

export function createFloorplanView(container, initialMap) {
  const svg = svgEl('svg', { class: 'floorplan', role: 'img' });
  const defs = svgEl('defs', {}, svg);
  const clip = svgEl('clipPath', { id: `room-${Math.random().toString(36).slice(2)}` }, defs);
  const clipRect = svgEl('rect', {}, clip);
  const baseG = svgEl('g', {}, svg);
  const linesG = svgEl('g', {}, svg);
  const posesG = svgEl('g', {}, svg);
  const editG = svgEl('g', {}, svg);
  container.append(svg);

  let map, D, poses = [], lines = [], editor = null, picker = null, drag = null;
  const sizes = () => ({ cone: D * 0.22, arm: D * 0.13, dot: D * 0.016, font: Math.max(map.width, map.length) * 0.036 });

  // ── drawing ──
  function drawBase() {
    baseG.replaceChildren();
    const { width: W, length: L, units } = map;
    const { font } = sizes();
    const pad = Math.max(W, L) * 0.1;
    svg.setAttribute('viewBox', [-pad, -pad, W + 2 * pad, L + 2 * pad].map(f).join(' '));
    svg.setAttribute('aria-label', `${map.name}: ${formatLength(W, units)} by ${formatLength(L, units)}`);
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: W, height: L })) clipRect.setAttribute(k, f(v));

    svgEl('rect', { class: 'room', x: 0, y: 0, width: f(W), height: f(L) }, baseG);
    const step = gridStep(Math.max(W, L), units);
    const grid = svgEl('g', { class: 'grid' }, baseG);
    for (let x = step.meters; x < W - 1e-6; x += step.meters) svgEl('line', { x1: f(x), y1: 0, x2: f(x), y2: f(L) }, grid);
    for (let y = step.meters; y < L - 1e-6; y += step.meters) svgEl('line', { x1: 0, y1: f(y), x2: f(W), y2: f(y) }, grid);
    svgEl('rect', { class: 'walls', x: 0, y: 0, width: f(W), height: f(L) }, baseG);

    // dimensions, grid size, compass
    const text = (t, attrs) => { const e = svgEl('text', { class: 'dim', 'font-size': f(font), ...attrs }, baseG); e.textContent = t; return e; };
    text(formatLength(W, units), { x: f(W / 2), y: f(-pad * 0.35), 'text-anchor': 'middle' });
    text(formatLength(L, units), { x: f(-pad * 0.35), y: f(L / 2), 'text-anchor': 'middle', transform: `rotate(-90 ${f(-pad * 0.35)} ${f(L / 2)})` });
    text(`grid ${step.label}`, { x: 0, y: f(L + pad * 0.6), 'text-anchor': 'start', class: 'dim muted' });
    if (map.topBearing != null) {
      const c = { x: W + pad * 0.5, y: -pad * 0.5 };
      const g = svgEl('g', { class: 'north', transform: `rotate(${f(-map.topBearing)} ${f(c.x)} ${f(c.y)})` }, baseG);
      const r = pad * 0.32;
      svgEl('path', { d: `M${f(c.x)} ${f(c.y - r)} L${f(c.x + r * 0.45)} ${f(c.y + r * 0.6)} L${f(c.x)} ${f(c.y + r * 0.25)} L${f(c.x - r * 0.45)} ${f(c.y + r * 0.6)}Z` }, g);
      const n = svgEl('text', { x: f(c.x), y: f(c.y - r * 1.15), 'font-size': f(font * 0.8), 'text-anchor': 'middle' }, g);
      n.textContent = 'N';
    }

    // labeled reference features
    const feats = svgEl('g', { class: 'features' }, baseG);
    for (const ft of map.features || []) {
      const g = svgEl('g', { class: 'feature' }, feats);
      svgEl('circle', { cx: f(ft.pos.x), cy: f(ft.pos.y), r: f(font * 0.32) }, g);
      const above = ft.pos.y > font * 1.6;
      const t = svgEl('text', {
        x: f(Math.min(W - font, Math.max(font, ft.pos.x))), y: f(above ? ft.pos.y - font * 0.6 : ft.pos.y + font * 1.3),
        'font-size': f(font), 'text-anchor': 'middle',
      }, g);
      t.textContent = ft.label;
    }
  }

  function drawPose(parent, { pos, heading, color, label, labelSide = 'right', editable }) {
    const { cone, arm, dot, font } = sizes();
    const g = svgEl('g', { class: `pose${editable ? ' editable' : ''}` }, parent);
    g.style.setProperty('--c', color);
    if (heading != null) {
      const a = along(pos, heading - CONE_HALF_ANGLE, cone), b = along(pos, heading + CONE_HALF_ANGLE, cone);
      svgEl('path', {
        class: 'cone', 'clip-path': `url(#${clip.id})`,
        d: `M${f(pos.x)} ${f(pos.y)} L${f(a.x)} ${f(a.y)} A${f(cone)} ${f(cone)} 0 0 1 ${f(b.x)} ${f(b.y)}Z`,
      }, g);
      const tip = along(pos, heading, arm);
      svgEl('line', { class: 'shaft', x1: f(pos.x), y1: f(pos.y), x2: f(tip.x), y2: f(tip.y) }, g);
      const head = along(pos, heading, arm + dot * 2.2), l = along(tip, heading - 90, dot * 1.3), r = along(tip, heading + 90, dot * 1.3);
      svgEl('path', { class: 'head', d: `M${f(head.x)} ${f(head.y)} L${f(l.x)} ${f(l.y)} L${f(r.x)} ${f(r.y)}Z` }, g);
      if (editable) svgEl('circle', { class: 'handle', cx: f(tip.x), cy: f(tip.y), r: f(dot * 1.7) }, g);
    }
    svgEl('circle', { class: 'dot', cx: f(pos.x), cy: f(pos.y), r: f(dot) }, g);
    if (label) {
      const left = labelSide === 'left';
      const t = svgEl('text', {
        class: 'pose-label', x: f(pos.x + (left ? -dot * 1.8 : dot * 1.8)), y: f(pos.y + dot * 3.2),
        'font-size': f(font * 0.9), 'text-anchor': left ? 'end' : 'start',
      }, g);
      t.textContent = label;
    }
  }

  function drawPoses() {
    posesG.replaceChildren();
    for (const p of poses) if (p.pos) drawPose(posesG, p);
  }

  function drawLines() {
    linesG.replaceChildren();
    for (const l of lines) {
      const e = svgEl('line', { class: 'link', x1: f(l.a.x), y1: f(l.a.y), x2: f(l.b.x), y2: f(l.b.y) }, linesG);
      if (l.color) e.style.stroke = l.color;
    }
  }

  function drawEditor() {
    editG.replaceChildren();
    if (editor?.state.pos) drawPose(editG, { ...editor.state, color: editor.color, label: editor.label, editable: true });
  }

  // ── input ──
  function toWorld(e) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  const pxToWorld = px => px / (svg.getScreenCTM()?.a || 1);

  function updateEditor(partial) {
    Object.assign(editor.state, partial);
    drawEditor();
    editor.onChange?.({ ...editor.state });
  }

  // Gesture: press where the photo was taken and drag toward where the camera looked.
  // Press on the marker to move it; press on the arrow tip to re-aim it.
  svg.addEventListener('pointerdown', e => {
    if (!editor || e.button > 0) return;
    const p = toWorld(e);
    if (!p) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const s = editor.state, hit = pxToWorld(HIT_PX);
    const tip = s.pos && along(s.pos, s.heading, sizes().arm);
    if (tip && distance(map, p, tip) < hit) drag = { mode: 'aim' };
    else if (s.pos && distance(map, p, s.pos) < hit) drag = { mode: 'move', dx: s.pos.x - p.x, dy: s.pos.y - p.y };
    else {
      drag = { mode: 'place', x0: e.clientX, y0: e.clientY, aiming: false };
      updateEditor({ pos: clampPos(map, p) });
    }
    drag.id = e.pointerId;
  });
  svg.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toWorld(e);
    if (!p) return;
    const s = editor.state;
    if (drag.mode === 'move') return updateEditor({ pos: clampPos(map, { x: p.x + drag.dx, y: p.y + drag.dy }) });
    if (drag.mode === 'place' && !drag.aiming) drag.aiming = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 12;
    if ((drag.mode === 'aim' || drag.aiming) && distance(map, s.pos, p) > pxToWorld(4)) updateEditor({ heading: Math.round(bearing(map, s.pos, p)) });
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('click', e => {
    if (!picker) return;
    const p = toWorld(e);
    if (!p) return;
    const cb = picker;
    stopEditing();
    cb(clampPos(map, p));
  });

  function stopEditing() {
    editor = null;
    picker = null;
    drag = null;
    svg.classList.remove('editing', 'picking');
    drawEditor();
  }

  function setMap(next) {
    map = next;
    D = mapSpan(map);
    drawBase();
    drawLines();
    drawPoses();
    drawEditor();
  }
  setMap(initialMap);

  return {
    setMap,
    setPoses(list) { poses = list || []; drawPoses(); },
    setLines(list) { lines = list || []; drawLines(); },
    editPose({ value, color = 'var(--guess)', label = '', onChange } = {}) {
      stopEditing();
      editor = { state: { pos: value?.pos ?? null, heading: value?.heading ?? 0 }, color, label, onChange };
      svg.classList.add('editing');
      drawEditor();
      return {
        set(partial) { if (editor) { Object.assign(editor.state, partial); drawEditor(); } },
        get: () => (editor ? { ...editor.state } : null),
        stop: stopEditing,
      };
    },
    pickPoint(onPick) {
      stopEditing();
      picker = onPick;
      svg.classList.add('picking');
    },
    stopEditing,
    destroy() { stopEditing(); svg.remove(); },
  };
}
