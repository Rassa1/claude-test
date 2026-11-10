import { defaultMatrix, computeLayout, applyShape, drawLeds, viewTransform, pitchMm } from './matrix.js';
import { ANIMS, PARAMS, DIRS, defaultParams, defaultDuration } from './animations.js';
import { parseDescription } from './parser.js';
import { compileCustom } from './custom.js';
import { generateSketch } from './codegen.js';
import { buildScene, renderScene, newInputState, newEffectState, engineStep, totalMs } from './engine.js';
import { interpret, getSample } from './ai.js';
import { pinUsage, pinOptions, pinProblems, setBoard, freePin as boardFreePin, remapPins, currentBoard, pinName, BOARDS } from './pins.js';
import { outColor } from './matrix.js';
import { textColumns, resolveFont } from './font.js';
import { lightCols } from './engine.js';

// seconds for a text step's message to scroll fully past once
function textPass(s) {
  const W = lightCols(layout) + 1;
  const TW = s.span === 'across' && state.matrix.lights === 'both' ? 2 * W + 2 : W;
  const cols = textColumns(s.text, resolveFont(s.font, state.matrix.rows.length)).length;
  return +((TW + cols) / s.speed).toFixed(2);
}
const fitText = (s, atLeast) => { if (s.type === 'text') s.duration = atLeast ? Math.max(s.duration, textPass(s)) : textPass(s); };

const $ = (s) => document.querySelector(s);
const STORE = 'taillight-studio-v3';

// ---------------------------------------------------------------- state
let uid = 1;
const newId = (p) => p + Date.now().toString(36) + (uid++);
function mkInput(name, pin, type = 'level', holdMs = 0, simPulse = false) {
  return { id: newId('i'), name, pin, type, holdMs, simPulse };
}
function mkFx(name, side, layer, repeat, prompt, trigger) {
  return { id: newId('e'), name, side, layer, repeat, prompt, steps: parseDescription(prompt), trigger: { kind: 'while', match: 'all', minOffMs: 0, cancel: false, conds: {}, ...trigger } };
}
function defaultModel() {
  const run = mkInput('Running lights', 25), brake = mkInput('Brake', 26);
  const L = mkInput('Left blinker', 14, 'level', 800, true), R = mkInput('Right blinker', 27, 'level', 800, true);
  const sweep = 'amber sequential sweep outward, 3 times';
  return {
    inputs: [run, brake, L, R],
    effects: [
      mkFx('Hazards', 'both', 'overlay', true, sweep, { conds: { [L.id]: 'on', [R.id]: 'on' } }),
      mkFx('Left turn', 'left', 'overlay', true, sweep, { conds: { [L.id]: 'on', [R.id]: 'off' } }),
      mkFx('Right turn', 'right', 'overlay', true, sweep, { conds: { [R.id]: 'on', [L.id]: 'off' } }),
      mkFx('Brake', 'both', 'replace', false, 'brake: flash red 4 times fast', { conds: { [brake.id]: 'on' } }),
      mkFx('Startup', 'both', 'replace', false, 'red sweep from the center out once then red breathe for 2 seconds',
        { kind: 'once', minOffMs: 30000, cancel: true, conds: { [run.id]: 'on' } }),
      mkFx('Running', 'both', 'replace', true, 'dim red tail light', { conds: { [run.id]: 'on' } }),
    ],
  };
}
// older saves had "buttons" (one pin each) – turn each into an input + an effect
function migrateButtons(buttons) {
  const inputs = [], effects = [];
  for (const b of buttons) {
    const inp = mkInput(b.name, b.pin, b.mode === 'toggle' ? 'toggle' : 'level', b.releaseMs || 0);
    inputs.push(inp);
    effects.push({ id: newId('e'), name: b.name, side: b.side, layer: b.layer, repeat: b.repeat, prompt: b.prompt, steps: b.steps,
      trigger: { kind: 'while', match: 'all', minOffMs: 0, cancel: false, conds: { [inp.id]: 'on' } } });
  }
  return { inputs, effects };
}
function load() {
  for (const key of [STORE, 'taillight-studio-v2']) {
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (!s || !s.matrix) continue;
      if (Array.isArray(s.effects) && Array.isArray(s.inputs)) return s;
      if (Array.isArray(s.buttons)) { Object.assign(s, migrateButtons(s.buttons)); delete s.buttons; return s; }
    } catch {}
  }
  return null;
}
let state = load() || { matrix: defaultMatrix(), ...defaultModel(), sel: 0 };
state.matrix.lights ??= 'both';
state.matrix.board ??= 'esp32';
setBoard(state.matrix.board);
state.matrix.outputs ??= [{ pinL: state.matrix.dataPin ?? 5, pinR: state.matrix.dataPinR ?? 18 }];
state.matrix.rows.forEach((r) => { r.out ??= 0; if (r.out >= state.matrix.outputs.length) r.out = 0; });
state.view ??= state.matrix.lights;
let layout = computeLayout(state.matrix);
let scene = buildScene(layout, state.view, state.matrix.lights === 'both');
let selRow = -1;

let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }, 200);
}
function matrixChanged() {
  layout = computeLayout(state.matrix);
  scene = buildScene(layout, state.view, state.matrix.lights === 'both');
  renderBuild();
  renderOutputs();
  save();
}
const warnHtml = (list) => list.map((w) => `<div>${w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`).join('');

// ---------------------------------------------------------------- tabs
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'build') renderBuild();
  if (name === 'code') renderCode();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => showTab(b.dataset.goto)));

// ---------------------------------------------------------------- builder
const bc = $('#buildCanvas');
const baseCount = () => Math.max(1, Math.round((state.matrix.rowLengthCm / 100) * state.matrix.ledsPerMeter));

function syncBuildInputs() {
  const m = state.matrix;
  $('#rows').value = m.rows.length;
  $('#density').value = m.ledsPerMeter;
  $('#rowLen').value = m.rowLengthCm;
  $('#rowGap').value = m.rowGapMm;
  $('#wiring').value = m.wiring;
  $('#start').value = m.start;
  renderRowTable();
}

function renderRowTable() {
  const el = $('#rowTable');
  el.innerHTML = '';
  state.matrix.rows.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'rowitem' + (i === selRow ? ' sel' : '');
    d.innerHTML = `<span>#${i + 1}</span>
      <input type="number" min="1" max="500" value="${r.count}" title="LEDs in this row" />
      <input type="number" step="0.5" value="${(+r.offset).toFixed(1)}" title="Shift (mm)" />
      <select title="Data line for this row" style="border-color:${outColor(r.out ?? 0, 0.8)}">${state.matrix.outputs.map((_, k) => `<option value="${k}" ${k === r.out ? 'selected' : ''}>Line ${k + 1}</option>`).join('')}</select>
      <button class="x" title="Remove row">×</button>`;
    const [cnt, off] = d.querySelectorAll('input');
    d.querySelector('select').onchange = (e) => { r.out = +e.target.value; renderRowTable(); matrixChanged(); };
    cnt.oninput = () => { r.count = Math.max(1, Math.min(500, +cnt.value || 1)); matrixChanged(); };
    off.oninput = () => { r.offset = +off.value || 0; matrixChanged(); };
    d.querySelector('.x').onclick = () => {
      if (state.matrix.rows.length > 1) { state.matrix.rows.splice(i, 1); selRow = -1; syncBuildInputs(); matrixChanged(); }
    };
    d.onclick = (e) => { if (e.target.tagName !== 'BUTTON') { selRow = i; markSel(); renderBuild(); } };
    el.appendChild(d);
  });
}
function markSel() {
  document.querySelectorAll('.rowitem').forEach((d, i) => d.classList.toggle('sel', i === selRow));
}

function renderBuild() {
  drawLeds(bc, layout, null, {
    showWiring: $('#showWiring').checked,
    showIndex: $('#showIndex').checked,
    highlightRow: selRow,
  });
  const m = state.matrix;
  const n = layout.leds.length;
  const wmm = layout.maxX - layout.minX, hmm = layout.maxY - layout.minY;
  $('#buildStats').textContent = `${n} LEDs · ${(wmm / 10).toFixed(1)} × ${(hmm / 10).toFixed(1)} cm · max ≈ ${((n * 60) / 1000).toFixed(1)} A @ 5V full white`;
  $('#perRow').textContent = `${baseCount()} LEDs per row at ${m.ledsPerMeter}/m (${pitchMm(m).toFixed(1)} mm apart)`;
}

$('#rows').oninput = (e) => {
  const n = Math.max(1, Math.min(40, +e.target.value || 1));
  const rows = state.matrix.rows;
  while (rows.length < n) rows.push({ ...rows[rows.length - 1] });
  rows.length = n;
  renderRowTable(); matrixChanged();
};
const resetCounts = () => { state.matrix.rows.forEach((r) => (r.count = baseCount())); renderRowTable(); matrixChanged(); };
$('#density').onchange = (e) => { state.matrix.ledsPerMeter = +e.target.value; resetCounts(); };
$('#rowLen').oninput = (e) => { state.matrix.rowLengthCm = Math.max(1, +e.target.value || 1); resetCounts(); };
$('#rowGap').oninput = (e) => { state.matrix.rowGapMm = Math.max(1, +e.target.value || 1); matrixChanged(); };
$('#wiring').onchange = (e) => { state.matrix.wiring = e.target.value; matrixChanged(); };
$('#start').onchange = (e) => { state.matrix.start = e.target.value; matrixChanged(); };
$('#showWiring').onchange = renderBuild;

// data lines (outputs)
function renderOutputs() {
  const m = state.matrix, root = $('#outputs');
  const usage = pinUsage(m, state.inputs);
  const both = m.lights === 'both';
  root.innerHTML = '';
  m.outputs.forEach((o, k) => {
    const info = layout.outInfo[k] || { count: 0 };
    const ms = info.count * 0.03;                       // WS2812: ~30 µs per LED
    const fps = info.count ? Math.min(400, Math.floor(1000 / (ms + 0.3))) : 0;
    const d = document.createElement('div');
    d.className = 'outcard';
    d.style.setProperty('--oc', outColor(k));
    const pinSel = (side, label) => `<label>${label}<select data-side="${side}">${pinOptions(side === 'R' ? o.pinR : o.pinL, usage, `LEDs ${both ? side : ''}${k + 1}`, true)}</select></label>`;
    d.innerHTML = `<div class="outcard-head"><span>Line ${k + 1}</span>
        <span class="meta ${info.count > 800 ? 'bad' : ''}">${info.count} LEDs · max ~${fps} fps</span>
        ${m.outputs.length > 1 ? '<button title="Remove this data line">×</button>' : '<span></span>'}</div>
      <div class="grid2">${m.lights !== 'right' ? pinSel('L', both ? 'Left light pin' : 'Pin') : ''}${m.lights !== 'left' ? pinSel('R', both ? 'Right light pin' : 'Pin') : ''}</div>
      <div class="rowchips" title="Rows on this line">${m.rows.map((r, i) => `<button data-row="${i}" class="${r.out === k ? 'on' : ''}" title="Row ${i + 1}: ${r.count} LEDs">${i + 1}</button>`).join('')}</div>`;
    d.querySelectorAll('select').forEach((sel) => (sel.onchange = (e) => {
      o[sel.dataset.side === 'R' ? 'pinR' : 'pinL'] = +e.target.value;
      renderOutputs(); save();
    }));
    d.querySelectorAll('.rowchips button').forEach((b) => (b.onclick = () => {
      m.rows[+b.dataset.row].out = k;
      renderRowTable(); matrixChanged();
    }));
    d.querySelector('.outcard-head button')?.addEventListener('click', () => {
      m.outputs.splice(k, 1);
      m.rows.forEach((r) => { if (r.out === k) r.out = Math.max(0, k - 1); else if (r.out > k) r.out--; });
      renderRowTable(); matrixChanged();
    });
    root.appendChild(d);
  });
  const lines = (both ? 2 : 1) * m.outputs.length;
  $('#addOut').disabled = m.outputs.length >= 8;
  const warn = pinProblems(m, state.inputs);
  if (m.outputs.some((_, k) => !(layout.outInfo[k]?.count))) warn.push('A data line has no rows – give it rows or remove it.');
  $('#buildWarn').innerHTML = warnHtml(warn);
}
function freePin(exclude = []) {
  return boardFreePin(pinUsage(state.matrix, state.inputs), 'led', exclude);
}
$('#addOut').onclick = () => {
  const m = state.matrix;
  const pinL = freePin(), pinR = freePin([pinL]);
  m.outputs.push({ pinL, pinR });
  // move the bottom half of the last line's rows to the new line
  const k = m.outputs.length - 1;
  const rows = m.rows.map((r, i) => (r.out === k - 1 ? i : -1)).filter((i) => i >= 0);
  rows.slice(Math.ceil(rows.length / 2)).forEach((i) => (m.rows[i].out = k));
  renderRowTable(); matrixChanged();
};
$('#splitOut').onclick = () => {
  const m = state.matrix, n = m.outputs.length;
  // contiguous blocks with roughly equal LED counts
  const total = m.rows.reduce((a, r) => a + r.count, 0);
  let acc = 0;
  m.rows.forEach((r) => { r.out = Math.min(n - 1, Math.floor((acc + r.count / 2) / (total / n))); acc += r.count; });
  renderRowTable(); matrixChanged();
};
$('#showIndex').onchange = renderBuild;
document.querySelectorAll('#shapes button').forEach((b) => (b.onclick = () => {
  applyShape(state.matrix, b.dataset.shape, +$('#shapeAmt').value);
  renderRowTable(); matrixChanged();
}));

// drag rows
let drag = null;
function rowAt(ev) {
  const rect = bc.getBoundingClientRect();
  const vt = viewTransform(bc, layout);
  const [, wy] = vt.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
  let best = -1, bd = Infinity;
  state.matrix.rows.forEach((_, i) => {
    const d = Math.abs(wy - i * state.matrix.rowGapMm);
    if (d < bd) { bd = d; best = i; }
  });
  return bd < Math.max(state.matrix.rowGapMm / 2, 8) ? best : -1;
}
bc.addEventListener('pointerdown', (ev) => {
  const r = rowAt(ev);
  selRow = r; markSel();
  if (r >= 0) {
    drag = { row: r, x0: ev.clientX, off0: state.matrix.rows[r].offset, vt: viewTransform(bc, layout) };
    bc.setPointerCapture(ev.pointerId);
  }
  renderBuild();
});
bc.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const dx = (ev.clientX - drag.x0) / drag.vt.s;
  state.matrix.rows[drag.row].offset = Math.round((drag.off0 + dx) * 2) / 2;
  layout = computeLayout(state.matrix);
  renderBuild();
});
bc.addEventListener('pointerup', () => { if (drag) { drag = null; renderRowTable(); matrixChanged(); } });


$('#board').innerHTML = Object.entries(BOARDS).map(([id, b]) => `<option value="${id}">${b.name}</option>`).join('');
$('#board').value = state.matrix.board;
$('#extraDark').value = state.matrix.extraDark || 0;
$('#extraDark').oninput = (e) => { state.matrix.extraDark = Math.max(0, Math.min(1000, +e.target.value | 0)); save(); };
$('#board').onchange = (e) => {
  state.matrix.board = e.target.value;
  setBoard(state.matrix.board);
  remapPins(state.matrix, state.inputs);
  renderOutputs(); renderInputs(); renderBar(); renderEditor(); save();
  toast(`Pins updated for the ${currentBoard().name}`);
};
$('#lights').value = state.matrix.lights;
$('#lights').onchange = (e) => {
  state.matrix.lights = e.target.value;
  setView(e.target.value);
  renderOutputs();
  save();
};

// ---------------------------------------------------------------- inputs, effects & simulator
const sc = $('#simCanvas');
let simNow = 0, lastTs = performance.now();
let lastSig = '';
let simIn = new Map();      // input id -> simulated wire { latched, latchedAt, held, downAt }
let inStates = [], fxStates = [], onMask = 0;
let previewFx = null;       // { id, since, until } – shows one effect right after it's generated
const sim = (k) => {
  const x = state.inputs[k];
  if (!simIn.has(x.id)) simIn.set(x.id, { latched: false, latchedAt: 0, held: false, downAt: 0 });
  return simIn.get(x.id);
};
const selFx = () => state.effects[state.sel] || state.effects[0];
const toHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const fxColor = (b) => {
  const s = b.steps.find((x) => x.color && x.type !== 'off');
  return s ? toHex(s.color) : (b.steps.some((x) => x.type === 'rainbow' || x.type === 'custom') ? '#c9a2ff' : '#666666');
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// engine state follows the model's shape (kept by id so edits don't reset everything)
let inStateById = new Map(), fxStateById = new Map();
function syncEngineStates() {
  inStates = state.inputs.map((x) => { if (!inStateById.has(x.id)) inStateById.set(x.id, newInputState()); return inStateById.get(x.id); });
  fxStates = state.effects.map((x) => { if (!fxStateById.has(x.id)) fxStateById.set(x.id, newEffectState()); return fxStateById.get(x.id); });
}
function powerCycle() {           // what the ESP32 sees after a restart
  inStateById = new Map(); fxStateById = new Map(); simNow = 0; previewFx = null;
  syncEngineStates();
}

function setView(v) {
  if (state.matrix.lights !== 'both') v = state.matrix.lights;
  state.view = v;
  scene = buildScene(layout, v, state.matrix.lights === 'both');
  document.querySelectorAll('#viewSel button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === v);
    b.disabled = state.matrix.lights !== 'both' && b.dataset.view !== state.matrix.lights;
  });
  save();
}
document.querySelectorAll('#viewSel button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ---- simulated wires: click = switch on/off, hold = only while held
function wireDown(k) { const s = sim(k); if (s.held) return; s.held = true; s.downAt = performance.now(); }
function wireUp(k) {
  const s = sim(k);
  if (!s.held) return;
  s.held = false;
  if (state.inputs[k].type !== 'toggle' && performance.now() - s.downAt < 300) {
    s.latched = !s.latched; s.latchedAt = simNow;
  }
}
function rawSignal(k) {
  const x = state.inputs[k], s = sim(k);
  if (x.type === 'toggle') return s.held;
  const pulse = x.simPulse && s.latched ? ((simNow - s.latchedAt) % 700) < 350 : s.latched;
  return s.held || pulse;
}

function renderBar() {
  lastSig = '';
  const bar = $('#btnbar');
  bar.innerHTML = '';
  state.inputs.forEach((x, k) => {
    const el = document.createElement('button');
    el.className = 'pbtn';
    el.innerHTML = `${k < 9 ? `<span class="key">${k + 1}</span>` : ''}<span class="dot"></span>${esc(x.name)}<small>GPIO ${x.pin}${x.type === 'toggle' ? ' · push button' : x.simPulse ? ' · flashing' : ''}</small>`;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} wireDown(k); });
    el.addEventListener('pointerup', () => wireUp(k));
    el.addEventListener('pointercancel', () => wireUp(k));
    el.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); wireDown(k); } });
    el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') wireUp(k); });
    bar.appendChild(el);
  });
}
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => {
  if (e.repeat || typing() || !$('#tab-animate').classList.contains('active')) return;
  const k = +e.key;
  if (k >= 1 && k <= 9 && state.inputs[k - 1]) wireDown(k - 1);
});
window.addEventListener('keyup', (e) => {
  const k = +e.key;
  if (k >= 1 && k <= 9 && state.inputs[k - 1]) wireUp(k - 1);
});
$('#allOff').onclick = () => { simIn = new Map(); };
$('#skip30').onclick = () => { simNow += 30000; };
$('#reboot').onclick = () => powerCycle();

// ---- inputs panel
function inputsChanged(rebuild) {
  syncEngineStates();
  if (rebuild) renderInputs();
  renderBar(); renderFxList(); renderEditor(); renderOutputs(); save();
}
function renderInputs() {
  const root = $('#inList');
  root.innerHTML = '';
  const usage = pinUsage(state.matrix, state.inputs);
  state.inputs.forEach((x, k) => {
    const d = document.createElement('div');
    d.className = 'incard';
    d.innerHTML = `<div class="incard-head"><input type="text" maxlength="30" value="${esc(x.name)}" aria-label="Input name">
        <button title="Delete input" ${state.inputs.length < 2 ? 'disabled' : ''}>×</button></div>
      <div class="grid2">
        <label>ESP32 pin<select data-f="pin">${pinOptions(x.pin, usage, x.name, false)}</select></label>
        <label>Signal<select data-f="type"><option value="level">Wire (on while powered)</option><option value="toggle">Push button (press = on/off)</option></select></label>
        <label ${x.type === 'toggle' ? 'hidden' : ''}>Hold after it drops (ms)<input type="number" data-f="holdMs" min="0" max="5000" step="50" value="${x.holdMs | 0}"></label>
        <label class="chk" ${x.type === 'toggle' ? 'hidden' : ''}><input type="checkbox" data-f="simPulse" ${x.simPulse ? 'checked' : ''}> Flashes like a blinker (sim)</label>
      </div>`;
    d.querySelector('select[data-f="type"]').value = x.type;
    d.querySelector('.incard-head input').oninput = (e) => { x.name = e.target.value || 'Input'; renderBar(); renderEditor(); save(); };
    d.querySelector('.incard-head button').onclick = () => {
      if (state.inputs.length < 2) return;
      state.inputs.splice(k, 1);
      state.effects.forEach((fx) => delete fx.trigger.conds[x.id]);
      simIn.delete(x.id);
      inputsChanged(true);
    };
    d.querySelector('[data-f="pin"]').onchange = (e) => { x.pin = +e.target.value; inputsChanged(true); };
    d.querySelector('[data-f="type"]').onchange = (e) => { x.type = e.target.value; inputsChanged(true); };
    d.querySelector('[data-f="holdMs"]').oninput = (e) => { x.holdMs = Math.max(0, Math.min(5000, +e.target.value | 0)); save(); };
    d.querySelector('[data-f="simPulse"]').onchange = (e) => { x.simPulse = e.target.checked; renderBar(); save(); };
    root.appendChild(d);
  });
  $('#addIn').disabled = state.inputs.length >= 16;
}
$('#addIn').onclick = () => {
  const used = pinUsage(state.matrix, state.inputs);
  state.inputs.push(mkInput('New input', boardFreePin(used, 'in')));
  inputsChanged(true);
};

// ---- effects list
function renderFxList() {
  const el = $('#fxList');
  el.innerHTML = '';
  state.effects.forEach((b, k) => {
    const d = document.createElement('div');
    d.className = 'bitem' + (k === state.sel ? ' sel' : '');
    d.dataset.k = k;
    d.innerHTML = `<span class="sw" style="background:${fxColor(b)}"></span>
      <div><div>${esc(b.name)} <span class="live" title="Running now"></span></div><div class="meta">${esc(triggerSummary(b))}</div></div>
      <span><button data-a="up" title="Higher priority">↑</button><button data-a="down" title="Lower priority">↓</button></span>
      <button data-a="del" title="Delete effect">×</button>`;
    d.onclick = (e) => {
      const a = e.target.dataset?.a, E = state.effects;
      if (a === 'up' && k > 0) { [E[k - 1], E[k]] = [E[k], E[k - 1]]; if (state.sel === k) state.sel--; else if (state.sel === k - 1) state.sel++; }
      else if (a === 'down' && k < E.length - 1) { [E[k + 1], E[k]] = [E[k], E[k + 1]]; if (state.sel === k) state.sel++; else if (state.sel === k + 1) state.sel--; }
      else if (a === 'del') { if (E.length > 1) { E.splice(k, 1); state.sel = Math.min(state.sel, E.length - 1); } }
      else state.sel = k;
      fxChanged(true);
    };
    el.appendChild(d);
  });
  lastSig = '';
}
function triggerSummary(fx) {
  const t = fx.trigger;
  const parts = state.inputs.filter((x) => t.conds[x.id] === 'on' || t.conds[x.id] === 'off')
    .map((x) => (t.conds[x.id] === 'off' ? 'not ' : '') + x.name);
  const cond = parts.length ? parts.join(t.match === 'any' ? ' or ' : ' + ') : 'no trigger set';
  const where = fx.side === 'both' ? '' : ` · ${fx.side} only`;
  if (t.kind === 'once') return `Once when ${cond}${t.minOffMs ? ` (if off ${Math.round(t.minOffMs / 1000)}s+)` : ''}${where}`;
  return `While ${cond}${where}`;
}
$('#addFx').onclick = () => {
  state.effects.unshift(mkFx('New effect', 'both', 'overlay', true, 'red knight rider scanner', {}));
  state.sel = 0;
  fxChanged(true);
};
function fxChanged(rebuildEditor) {
  syncEngineStates();
  renderFxList();
  if (rebuildEditor) renderEditor();
  save();
}

// ---- effect editor
let aiCtl = null;
function renderEditor() {
  const b = selFx();
  const root = $('#btnEditor');
  if (!b) { root.innerHTML = ''; return; }
  const t = b.trigger;
  root.innerHTML = `<div class="editor-card">
    <h3>Effect</h3>
    <div class="grid2">
      <label class="full2">Name<input type="text" id="bName" maxlength="40" value="${esc(b.name)}"></label>
      <label>Lights<select id="bSide"><option value="both">Both</option><option value="left">Left only</option><option value="right">Right only</option></select></label>
      <label>When on<select id="bLayer"><option value="replace">Replace effects below</option><option value="overlay">Lay lit LEDs on top</option></select></label>
    </div>

    <h3>Trigger</h3>
    <div class="grid2">
      <label class="full2">Runs<select id="tKind"><option value="while">While the condition is true</option><option value="once">Once, when the condition turns on</option></select></label>
    </div>
    <div class="condlabel">Condition <span class="muted small">click an input: ignore → ON → OFF</span></div>
    <div class="conds" id="conds">${state.inputs.map((x) => {
      const c = t.conds[x.id] || 'ignore';
      return `<button data-id="${x.id}" class="cond ${c}">${c === 'on' ? '● ' : c === 'off' ? '○ not ' : ''}${esc(x.name)}</button>`;
    }).join('')}</div>
    <div class="grid2 sm-top">
      <label>Inputs must<select id="tMatch"><option value="all">All match</option><option value="any">Any one matches</option></select></label>
      <label id="wRepeat">Playback<select id="bRepeat"><option value="1">Loop while on</option><option value="0">Play once, hold end</option></select></label>
      <label id="wMinOff">Only if it was off for at least (s)<input type="number" id="tMinOff" min="0" max="86400" step="1" value="${Math.round((t.minOffMs || 0) / 1000)}"></label>
      <label id="wCancel" class="chk"><input type="checkbox" id="tCancel" ${t.cancel ? 'checked' : ''}> Stop early if it turns off</label>
    </div>
    <p class="muted small-p sm-top" id="tExplain"></p>

    <h3>Describe the animation <span class="badge" id="aiBadge">checking AI…</span></h3>
    <textarea id="bPrompt" rows="3" placeholder="e.g. red light that fills from the inside out, then pulses twice">${esc(b.prompt || '')}</textarea>
    <div class="ai-row">
      <button class="primary" id="bGen">Generate ✦</button>
      <button class="ghost" id="bStop" hidden>Stop</button>
      <button class="ghost" id="bPreview" title="Play this effect now, ignoring its trigger">Preview</button>
      <span class="muted small">Ctrl/⌘+Enter</span>
    </div>
    <div class="ai-status" id="aiStatus"></div>

    <h3>Steps <span class="muted small">(fine-tune anything)</span></h3>
    <div id="steps"></div>
    <button id="addStep" class="ghost wide sm-top">+ Add step</button>
  </div>`;
  $('#bSide').value = b.side; $('#bLayer').value = b.layer; $('#bRepeat').value = b.repeat ? '1' : '0';
  $('#tKind').value = t.kind; $('#tMatch').value = t.match;
  const showKind = () => {
    $('#wRepeat').hidden = t.kind === 'once';
    $('#wMinOff').hidden = $('#wCancel').hidden = t.kind !== 'once';
    $('#tExplain').textContent = explain(b);
  };
  showKind();
  $('#bName').oninput = (e) => { b.name = e.target.value || 'Effect'; renderFxList(); save(); };
  $('#bSide').onchange = (e) => { b.side = e.target.value; renderFxList(); save(); };
  $('#bLayer').onchange = (e) => { b.layer = e.target.value; save(); };
  $('#bRepeat').onchange = (e) => { b.repeat = e.target.value === '1'; save(); };
  $('#tKind').onchange = (e) => { t.kind = e.target.value; showKind(); renderFxList(); save(); };
  $('#tMatch').onchange = (e) => { t.match = e.target.value; showKind(); renderFxList(); save(); };
  $('#tMinOff').oninput = (e) => { t.minOffMs = Math.max(0, Math.min(86400, +e.target.value || 0)) * 1000; showKind(); renderFxList(); save(); };
  $('#tCancel').onchange = (e) => { t.cancel = e.target.checked; showKind(); save(); };
  document.querySelectorAll('#conds .cond').forEach((el) => (el.onclick = () => {
    const id = el.dataset.id, cur = t.conds[id] || 'ignore';
    const next = { ignore: 'on', on: 'off', off: 'ignore' }[cur];
    if (next === 'ignore') delete t.conds[id]; else t.conds[id] = next;
    renderEditor(); renderFxList(); save();
  }));
  $('#bPrompt').oninput = (e) => { b.prompt = e.target.value; save(); };
  $('#bPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#bGen').click(); });
  $('#bGen').onclick = () => generate(b);
  $('#bStop').onclick = () => aiCtl?.abort();
  $('#bPreview').onclick = () => preview(b);
  $('#addStep').onclick = () => {
    const s = { type: 'solid', ...defaultParams('solid') };
    s.duration = defaultDuration(s);
    b.steps.push(s); renderSteps(b); fxChanged();
  };
  getSample().then((s) => {
    const el = $('#aiBadge');
    if (!el) return;
    el.textContent = s ? 'AI on' : 'AI off · keyword mode';
    el.classList.toggle('ai-on', !!s);
    el.title = s ? 'Claude reads your description' : 'AI works when this page is opened on claude.ai. Using the built-in keyword parser.';
  });
  renderSteps(b);
}
function explain(fx) {
  const t = fx.trigger, s = triggerSummary(fx);
  if (!Object.keys(t.conds).length) return 'Pick at least one input above, or this effect never runs.';
  if (t.kind === 'once') {
    return `Plays its steps one time when the condition turns on${t.minOffMs ? `, but only if it had been off for ${Math.round(t.minOffMs / 1000)} s or more (or since the ESP32 powered up)` : ''}${t.cancel ? '. Stops early if the condition turns off' : ''}. Use "+30 s" and "Power-cycle ESP32" above the lights to test it.`;
  }
  return `${s}. ${fx.repeat ? 'Loops' : 'Plays once and holds the last frame'} until the condition turns off.`;
}

async function generate(b) {
  const text = (b.prompt || '').trim();
  if (!text) { setStatus('Type what you want the lights to do first.', 'warn'); return; }
  aiCtl = new AbortController();
  $('#bGen').disabled = true; $('#bStop').hidden = false;
  setStatus('Thinking…');
  try {
    const ctx = {
      leds: layout.leds.length, rows: state.matrix.rows.length,
      widthCm: ((layout.maxX - layout.minX) / 10).toFixed(1), heightCm: ((layout.maxY - layout.minY) / 10).toFixed(1),
      cols: Math.round((layout.maxX - layout.minX) / layout.pitch) + 1,
      name: b.name, side: b.side, repeat: b.trigger.kind === 'while' && b.repeat,
    };
    const res = await interpret(text, ctx, aiCtl.signal);
    if (selFx() !== b) return;
    b.steps = res.steps;
    b.steps.forEach((x) => fitText(x, res.via === 'ai'));
    if (res.repeat !== null && b.trigger.kind === 'while') b.repeat = res.repeat;
    renderEditor();
    setStatus(res.via === 'ai' ? '✦ ' + (res.summary || 'Done.') : res.note, res.via === 'ai' ? 'ai' : 'warn');
    fxChanged();
    preview(b);
  } catch (e) {
    if (e?.code !== 'cancelled') setStatus('Something went wrong. Try again.', 'warn');
    else setStatus('Stopped.');
  } finally {
    if ($('#bGen')) { $('#bGen').disabled = false; $('#bStop').hidden = true; }
  }
}
function setStatus(msg, cls = '') { const el = $('#aiStatus'); if (el) { el.textContent = msg; el.className = 'ai-status ' + cls; } }

// play one effect now, regardless of its trigger
function preview(b) {
  const loops = b.trigger.kind === 'while' && b.repeat;
  previewFx = { id: b.id, since: simNow, until: simNow + Math.min(totalMs(b) * (loops ? 2 : 1) + (loops ? 0 : 800), 15000) };
}

function renderSteps(b) {
  const root = $('#steps');
  root.innerHTML = '';
  b.steps.forEach((s, k) => {
    const def = ANIMS[s.type] || ANIMS.off;
    const el = document.createElement('div');
    el.className = 'step';
    el.dataset.k = k;
    const opts = Object.entries(ANIMS).map(([id, a]) => `<option value="${id}" ${id === s.type ? 'selected' : ''}>${a.name}</option>`).join('');
    el.innerHTML = `<div class="step-head"><span class="num">${k + 1}</span><select aria-label="Animation type">${opts}</select>
      <button data-a="up" title="Move up">↑</button><button data-a="dup" title="Duplicate">⧉</button><button data-a="del" title="Delete">×</button></div>
      <div class="step-desc">${def.desc}</div><div class="params"></div>`;
    el.querySelector('select').onchange = (e) => {
      const keep = { duration: s.duration, brightness: s.brightness, color: s.color };
      for (const key of Object.keys(s)) delete s[key];
      Object.assign(s, { type: e.target.value, ...defaultParams(e.target.value) });
      if (keep.color && e.target.value !== 'off') s.color = keep.color;
      s.duration = defaultDuration(s);
      fitText(s);
      renderSteps(b); fxChanged();
    };
    el.querySelectorAll('.step-head button').forEach((x) => (x.onclick = () => {
      const a = x.dataset.a;
      if (a === 'del' && b.steps.length > 1) b.steps.splice(k, 1);
      if (a === 'dup') b.steps.splice(k + 1, 0, structuredClone(s));
      if (a === 'up' && k > 0) [b.steps[k - 1], b.steps[k]] = [b.steps[k], b.steps[k - 1]];
      renderSteps(b); fxChanged();
    }));

    const P = el.querySelector('.params');
    const refit = () => { if (s.type !== 'text') return; fitText(s); const li = P.querySelector('input[data-len]'); if (li) li.value = s.duration; };
    const add = (html, bind, cls) => { const l = document.createElement('label'); if (cls) l.className = cls; l.innerHTML = html; P.appendChild(l); bind(l); };
    add(`Length (s) <input type="number" data-len min="0.05" step="0.05" value="${s.duration}">`, (l) => {
      l.querySelector('input').oninput = (e) => { s.duration = Math.max(0.05, +e.target.value || 0.05); save(); };
    });
    add(`Brightness <span class="val">${Math.round(s.brightness * 100)}%</span><input type="range" min="0.02" max="1" step="0.01" value="${s.brightness}">`, (l) => {
      l.querySelector('input').oninput = (e) => { s.brightness = +e.target.value; l.querySelector('.val').textContent = Math.round(s.brightness * 100) + '%'; save(); };
    });
    for (const key of def.uses) {
      const pd = PARAMS[key];
      if (pd.type === 'color') {
        add(`${pd.label}<div class="colorrow"><input type="color" value="${toHex(s[key])}"><span class="val">${toHex(s[key])}</span></div>`, (l) => {
          const i = l.querySelector('input');
          i.oninput = () => { s[key] = fromHex(i.value); l.querySelector('.val').textContent = i.value; renderFxList(); save(); };
        });
      } else if (pd.type === 'range') {
        add(`${pd.label} <span class="val">${(+s[key]).toFixed(2)}</span><input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = +e.target.value; l.querySelector('.val').textContent = s[key].toFixed(2); if (key === 'speed') refit(); save(); };
        });
      } else if (pd.type === 'int') {
        add(`${pd.label}<input type="number" min="${pd.min}" max="${pd.max}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = Math.max(pd.min, Math.min(pd.max, Math.round(+e.target.value || pd.min))); save(); };
        });
      } else if (pd.type === 'dir') {
        add(`${pd.label}<select>${Object.entries(DIRS).map(([id, n]) => `<option value="${id}" ${id === s[key] ? 'selected' : ''}>${n}</option>`).join('')}</select>`, (l) => {
          l.querySelector('select').onchange = (e) => { s[key] = e.target.value; save(); };
        });
      } else if (pd.type === 'text') {
        add(`${pd.label}<input type="text" maxlength="64" value="${esc(s[key] ?? '')}" placeholder="Your message">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = e.target.value; refit(); save(); };
        }, 'full');
      } else if (pd.type === 'select') {
        add(`${pd.label}<select>${Object.entries(pd.options).map(([id, n]) => `<option value="${id}" ${id === s[key] ? 'selected' : ''}>${n}</option>`).join('')}</select>`, (l) => {
          l.querySelector('select').onchange = (e) => { s[key] = e.target.value; refit(); save(); };
        });
      } else if (pd.type === 'code') {
        add(`${pd.label} <span class="muted">(r, g, b from 0 to 1)</span><textarea class="code-in" spellcheck="false">${esc(s[key])}</textarea><span class="err"></span>`, (l) => {
          const ta = l.querySelector('textarea'), err = l.querySelector('.err');
          const check = () => { try { compileCustom(ta.value); err.textContent = ''; return true; } catch (x) { err.textContent = x.message; return false; } };
          check();
          ta.oninput = () => { if (check()) { s[key] = ta.value; save(); } };
        }, 'full');
      }
    }
    root.appendChild(el);
  });
}

// ---------------------------------------------------------------- animation loop
function tick(ts) {
  const dt = Math.min(100, ts - lastTs);
  lastTs = ts;
  simNow += dt * +$('#simSpeed').value;
  if (inStates.length !== state.inputs.length || fxStates.length !== state.effects.length) syncEngineStates();
  const raws = state.inputs.map((_, k) => rawSignal(k));
  onMask = engineStep({ inputs: state.inputs, effects: state.effects }, inStates, fxStates, raws, simNow);
  if (previewFx && simNow >= previewFx.until) previewFx = null;

  if ($('#tab-animate').classList.contains('active')) {
    const shown = fxStates.map((st, k) => (previewFx && state.effects[k].id === previewFx.id ? { active: true, since: previewFx.since } : st));
    const { colors, act } = renderScene(scene, state.effects, shown, simNow);
    drawLeds(sc, scene, colors, { pad: 36 });
    const sig = onMask + ':' + act.map((a) => (a ? 1 : 0)).join('');
    if (sig !== lastSig) {
      lastSig = sig;
      document.querySelectorAll('.pbtn').forEach((el, k) => el.classList.toggle('on', !!(onMask & (1 << k))));
      document.querySelectorAll('#fxList .bitem').forEach((el) => el.classList.toggle('running', !!act[+el.dataset.k]));
    }
    const b = selFx(), k = state.sel;
    document.querySelectorAll('#steps .step').forEach((el) => el.classList.toggle('active', !!act[k] && act[k].step === b.steps[+el.dataset.k]));
    $('#simClock').textContent = fmtClock(simNow);
  }
  requestAnimationFrame(tick);
}
const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- code
let sketch = '';
function syncHwInputs() {
  const m = state.matrix;
  $('#ledType').value = m.ledType;
  $('#colorOrder').value = m.colorOrder; $('#maxMa').value = m.maxMilliamps;
}
[['#ledType', 'ledType'], ['#colorOrder', 'colorOrder'], ['#maxMa', 'maxMilliamps', true]].forEach(([sel, key, isNum]) => {
  $(sel).addEventListener('input', (e) => { state.matrix[key] = isNum ? +e.target.value : e.target.value; save(); renderCode(); });
});
function highlight(src) {
  const e = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(#\w+)|\b(static|const|inline|float|int|bool|void|return|uint8_t|uint16_t|uint32_t|if|else|while|for|switch|case|default|break|continue|struct|true|false|CRGB)\b|\b(\d+(?:\.\d+)?f?u?)\b/g,
    (m, c, p, k, n) => c ? `<span class="c">${c}</span>` : p ? `<span class="p">${p}</span>` : k ? `<span class="k">${k}</span>` : `<span class="n">${n}</span>`);
}
function renderCode() {
  sketch = generateSketch(state.matrix, layout, { inputs: state.inputs, effects: state.effects });
  $('#code').innerHTML = highlight(sketch);
  const n = layout.leds.length;
  const sides = state.matrix.lights === 'both' ? 2 : 1;
  $('#codeInfo').textContent = `taillight.ino · ${n} LEDs × ${sides} light${sides > 1 ? 's' : ''} · ${state.inputs.length} inputs · ${state.effects.length} effects · ${sketch.split('\n').length} lines`;
  const usage = [...pinUsage(state.matrix, state.inputs)].sort((a, b) => a[0] - b[0]);
  $('#pinTable').innerHTML = usage.map(([p, who]) => `<span class="p">${pinName(p)}</span><span class="w">${who.map((w) => String(w).replace(/[&<>]/g, '')).join(', ')}</span>`).join('');
  $('#codeWarn').innerHTML = warnHtml([
    ...(state.matrix.benchForce?.length ? ['Bench test is on: some inputs are forced ON in this code. Turn it off before fitting to the car.'] : []),
    ...pinProblems(state.matrix, state.inputs),
  ]);
  $('#debugSerial').checked = state.matrix.debugSerial !== false;
  const forced = new Set(state.matrix.benchForce || []);
  $('#benchForce').innerHTML = state.inputs.map((x) => `<button data-id="${x.id}" class="cond ${forced.has(x.id) ? 'on' : ''}">${forced.has(x.id) ? '● ' : ''}${esc(x.name)}</button>`).join('');
  document.querySelectorAll('#benchForce .cond').forEach((el) => (el.onclick = () => {
    const ids = new Set(state.matrix.benchForce || []);
    ids.has(el.dataset.id) ? ids.delete(el.dataset.id) : ids.add(el.dataset.id);
    state.matrix.benchForce = state.inputs.map((x) => x.id).filter((id) => ids.has(id));
    save(); renderCode();
  }));
  const amps = (n * sides * (/RGBW/.test(state.matrix.ledType) ? 80 : 60)) / 1000;
  $('#powerInfo').textContent = `Worst case (all white): ${amps.toFixed(1)} A. Code caps it at ${(state.matrix.maxMilliamps / 1000).toFixed(1)} A, so size your 5V supply for at least that.`;
}
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}
$('#debugSerial').onchange = (e) => { state.matrix.debugSerial = e.target.checked; save(); renderCode(); };
$('#copy').onclick = async () => {
  try { await navigator.clipboard.writeText(sketch); toast('Copied to clipboard'); }
  catch { const r = document.createRange(); r.selectNodeContents($('#code')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Press Ctrl/Cmd+C to copy'); }
};
let downloads = null;
$('#download').onclick = async () => {
  try {
    downloads ??= window.claude?.use ? await window.claude.use('downloads') : null;
    if (downloads) { await downloads.save({ filename: 'taillight.ino', data: sketch }); return; }
  } catch (e) { if (e?.code) { toast('Download cancelled'); return; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sketch], { type: 'text/plain' }));
  a.download = 'taillight.ino';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------------------------------------------------------------- boot
window.addEventListener('resize', () => { if ($('#tab-build').classList.contains('active')) renderBuild(); });
// start with the running-light power on
const running = state.inputs.findIndex((x) => /running|tail|park/i.test(x.name) && x.type !== 'toggle');
if (running >= 0) sim(running).latched = true;
syncBuildInputs();
syncHwInputs();
setView(state.view);
renderInputs();
renderFxList();
renderBar();
renderEditor();
renderBuild();
renderOutputs();
requestAnimationFrame(tick);
