import { defaultMatrix, computeLayout, applyShape, drawLeds, viewTransform, pitchMm } from './matrix.js';
import { ANIMS, PARAMS, DIRS, defaultParams, defaultDuration, compiled } from './animations.js';
import { parseDescription } from './parser.js';
import { compileCustom } from './custom.js';
import { generateSketch } from './codegen.js';
import { buildScene, renderScene, newInputState, press, release, isActive, totalMs, stepAt } from './engine.js';
import { interpret, getSample } from './ai.js';
import { pinUsage, pinOptions, pinProblems, MAX_LED_OUTPUTS } from './pins.js';
import { outColor } from './matrix.js';

const $ = (s) => document.querySelector(s);
const STORE = 'taillight-studio-v2';
const SAFE_PINS = [13, 14, 27, 26, 25, 33, 32, 4, 16, 17, 19, 21, 22, 23];

// ---------------------------------------------------------------- state
let uid = 1;
function mkBtn(name, mode, side, layer, repeat, pin, prompt, extra = {}) {
  return { id: 'b' + Date.now().toString(36) + uid++, name, mode, side, layer, repeat, pin, releaseMs: 0, prompt, steps: parseDescription(prompt), ...extra };
}
function defaultButtons() {
  return [
    mkBtn('Hazards', 'toggle', 'both', 'overlay', true, 13, 'amber sequential sweep outward, 3 times'),
    mkBtn('Left turn', 'toggle', 'left', 'overlay', true, 14, 'amber sequential sweep outward, 3 times'),
    mkBtn('Right turn', 'toggle', 'right', 'overlay', true, 27, 'amber sequential sweep outward, 3 times'),
    mkBtn('Brake', 'momentary', 'both', 'replace', false, 26, 'brake: flash red 4 times fast'),
    mkBtn('Running', 'toggle', 'both', 'replace', true, 25, 'dim red tail light'),
  ];
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.matrix && Array.isArray(s.buttons)) return s;
  } catch {}
  return null;
}
let state = load() || { matrix: defaultMatrix(), buttons: defaultButtons(), sel: 0 };
state.matrix.lights ??= 'both';
state.matrix.outputs ??= [{ pinL: state.matrix.dataPin ?? 5, pinR: state.matrix.dataPinR ?? 18 }];
state.matrix.rows.forEach((r) => { r.out ??= 0; if (r.out >= state.matrix.outputs.length) r.out = 0; });
state.view ??= state.matrix.lights;
let layout = computeLayout(state.matrix);
let scene = buildScene(layout, state.view);
let selRow = -1;

let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }, 200);
}
function matrixChanged() {
  layout = computeLayout(state.matrix);
  scene = buildScene(layout, state.view);
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
  const usage = pinUsage(m, state.buttons);
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
  $('#addOut').disabled = lines + (both ? 2 : 1) > MAX_LED_OUTPUTS;
  const warn = pinProblems(m, state.buttons);
  if (m.outputs.some((_, k) => !(layout.outInfo[k]?.count))) warn.push('A data line has no rows – give it rows or remove it.');
  $('#buildWarn').innerHTML = warnHtml(warn);
}
function freePin(exclude = []) {
  const used = new Set([...pinUsage(state.matrix, state.buttons).keys(), ...exclude]);
  return [16, 17, 19, 21, 22, 23, 4, 32, 33, 13, 14, 25, 26, 27, 5, 18].find((p) => !used.has(p)) ?? 4;
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


$('#lights').value = state.matrix.lights;
$('#lights').onchange = (e) => {
  state.matrix.lights = e.target.value;
  setView(e.target.value);
  renderOutputs();
  save();
};

// ---------------------------------------------------------------- buttons & simulator
const sc = $('#simCanvas');
let simNow = 0, lastTs = performance.now();
let lastActiveSig = '';
let inputs = new Map();       // button id -> input state
const pendingRelease = new Map();
const inp = (b) => { if (!inputs.has(b.id)) inputs.set(b.id, newInputState()); return inputs.get(b.id); };
const selBtn = () => state.buttons[state.sel] || state.buttons[0];
const toHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const btnColor = (b) => {
  const s = b.steps.find((x) => x.color && x.type !== 'off');
  return s ? toHex(s.color) : (b.steps.some((x) => x.type === 'rainbow' || x.type === 'custom') ? '#c9a2ff' : '#666666');
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setView(v) {
  // a single-light build can only show that light
  if (state.matrix.lights !== 'both') v = state.matrix.lights;
  state.view = v;
  scene = buildScene(layout, v);
  document.querySelectorAll('#viewSel button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === v);
    b.disabled = state.matrix.lights !== 'both' && b.dataset.view !== state.matrix.lights;
  });
  save();
}
document.querySelectorAll('#viewSel button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

function doPress(b) { press(b, inp(b), simNow); pendingRelease.delete(b.id); }
function doRelease(b) { release(b, inp(b), simNow); }

// stage button bar
function renderBar() {
  lastActiveSig = '';
  const bar = $('#btnbar');
  bar.innerHTML = '';
  state.buttons.forEach((b, k) => {
    const el = document.createElement('button');
    el.className = 'pbtn';
    el.dataset.id = b.id;
    el.style.setProperty('--glow', btnColor(b));
    el.innerHTML = `${k < 9 ? `<span class="key">${k + 1}</span>` : ''}<span class="dot"></span>${esc(b.name)}<small>${b.mode === 'toggle' ? 'toggle' : 'hold'} · ${b.side === 'both' ? 'both' : b.side}</small>`;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} doPress(b); });
    const up = () => doRelease(b);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); doPress(b); } });
    el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') doRelease(b); });
    bar.appendChild(el);
  });
}
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => {
  if (e.repeat || typing() || !$('#tab-animate').classList.contains('active')) return;
  const k = +e.key;
  if (k >= 1 && k <= 9 && state.buttons[k - 1]) doPress(state.buttons[k - 1]);
});
window.addEventListener('keyup', (e) => {
  const k = +e.key;
  if (k >= 1 && k <= 9 && state.buttons[k - 1]) doRelease(state.buttons[k - 1]);
});
$('#allOff').onclick = () => { inputs = new Map(); pendingRelease.clear(); };

// panel: list of buttons
function renderList() {
  const el = $('#btnList');
  el.innerHTML = '';
  state.buttons.forEach((b, k) => {
    const d = document.createElement('div');
    d.className = 'bitem' + (k === state.sel ? ' sel' : '');
    d.innerHTML = `<span class="sw" style="background:${btnColor(b)}"></span>
      <div><div>${esc(b.name)}</div><div class="meta">${b.mode === 'toggle' ? 'Toggle' : 'Momentary'} · ${b.side === 'both' ? 'both lights' : b.side + ' light'} · GPIO ${b.pin}</div></div>
      <span><button data-a="up" title="Higher priority">↑</button><button data-a="down" title="Lower priority">↓</button></span>
      <button data-a="del" title="Delete button">×</button>`;
    d.onclick = (e) => {
      const a = e.target.dataset?.a;
      if (a === 'up' && k > 0) { [state.buttons[k - 1], state.buttons[k]] = [state.buttons[k], state.buttons[k - 1]]; if (state.sel === k) state.sel--; else if (state.sel === k - 1) state.sel++; }
      else if (a === 'down' && k < state.buttons.length - 1) { [state.buttons[k + 1], state.buttons[k]] = [state.buttons[k], state.buttons[k + 1]]; if (state.sel === k) state.sel++; else if (state.sel === k + 1) state.sel--; }
      else if (a === 'del') { if (state.buttons.length > 1) { state.buttons.splice(k, 1); state.sel = Math.min(state.sel, state.buttons.length - 1); } }
      else state.sel = k;
      buttonsChanged(true);
    };
    el.appendChild(d);
  });
}
$('#addBtn').onclick = () => {
  const used = pinUsage(state.matrix, state.buttons);
  const pin = SAFE_PINS.find((p) => !used.has(p)) ?? 15;
  state.buttons.unshift(mkBtn('New button', 'toggle', 'both', 'overlay', true, pin, 'red knight rider scanner'));
  state.sel = 0;
  buttonsChanged(true);
};
function buttonsChanged(rebuildEditor) {
  renderList(); renderBar();
  if (rebuildEditor) renderEditor();
  save();
}

// panel: editor for the selected button
let aiCtl = null;
function renderEditor() {
  const b = selBtn();
  const root = $('#btnEditor');
  if (!b) { root.innerHTML = ''; return; }
  root.innerHTML = `<div class="editor-card">
    <h3>Button settings</h3>
    <div class="grid2">
      <label class="full2">Name<input type="text" id="bName" maxlength="40" value="${esc(b.name)}"></label>
      <label>ESP32 pin that triggers it<select id="bPin">${pinOptions(b.pin, pinUsage(state.matrix, state.buttons), b.name, false)}</select></label>
      <label>Mode<select id="bMode"><option value="toggle">Toggle (on/off)</option><option value="momentary">Momentary (hold)</option></select></label>
      <label>Lights<select id="bSide"><option value="both">Both</option><option value="left">Left only</option><option value="right">Right only</option></select></label>
      <label>When on<select id="bLayer"><option value="replace">Replace lower layers</option><option value="overlay">Lay lit LEDs on top</option></select></label>
      <label>Playback<select id="bRepeat"><option value="1">Loop while on</option><option value="0">Play once, hold end</option></select></label>
      <label id="bRelWrap">Stay on after release (ms)<input type="number" id="bRel" min="0" max="5000" step="50" value="${b.releaseMs || 0}"></label>
    </div>

    <div class="pinwarn">${warnHtml(pinProblems(state.matrix, state.buttons).filter((w) => w.includes('GPIO ' + b.pin + ' ')))}</div>

    <h3>Describe the animation <span class="badge" id="aiBadge">checking AI…</span></h3>
    <textarea id="bPrompt" rows="3" placeholder="e.g. red light that fills from the inside out, then pulses twice">${esc(b.prompt || '')}</textarea>
    <div class="ai-row">
      <button class="primary" id="bGen">Generate ✦</button>
      <button class="ghost" id="bStop" hidden>Stop</button>
      <span class="muted small">Ctrl/⌘+Enter</span>
    </div>
    <div class="ai-status" id="aiStatus"></div>

    <h3>Steps <span class="muted small">(fine-tune anything)</span></h3>
    <div id="steps"></div>
    <button id="addStep" class="ghost wide sm-top">+ Add step</button>
  </div>`;
  $('#bMode').value = b.mode; $('#bSide').value = b.side; $('#bLayer').value = b.layer; $('#bRepeat').value = b.repeat ? '1' : '0';
  $('#bRelWrap').hidden = b.mode === 'toggle';
  $('#bName').oninput = (e) => { b.name = e.target.value || 'Button'; renderList(); renderBar(); save(); };
  $('#bPin').onchange = (e) => { b.pin = +e.target.value; renderList(); renderEditor(); renderOutputs(); save(); };
  $('#bMode').onchange = (e) => { b.mode = e.target.value; inputs.delete(b.id); $('#bRelWrap').hidden = b.mode === 'toggle'; buttonsChanged(); };
  $('#bSide').onchange = (e) => { b.side = e.target.value; buttonsChanged(); };
  $('#bLayer').onchange = (e) => { b.layer = e.target.value; save(); };
  $('#bRepeat').onchange = (e) => { b.repeat = e.target.value === '1'; save(); };
  $('#bRel').oninput = (e) => { b.releaseMs = Math.max(0, Math.min(5000, +e.target.value | 0)); save(); };
  $('#bPrompt').oninput = (e) => { b.prompt = e.target.value; save(); };
  $('#bPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#bGen').click(); });
  $('#bGen').onclick = () => generate(b);
  $('#bStop').onclick = () => aiCtl?.abort();
  $('#addStep').onclick = () => {
    const s = { type: 'solid', ...defaultParams('solid') };
    s.duration = defaultDuration(s);
    b.steps.push(s); renderSteps(b); buttonsChanged();
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
      name: b.name, side: b.side, repeat: b.repeat,
    };
    const res = await interpret(text, ctx, aiCtl.signal);
    if (selBtn() !== b) return;
    b.steps = res.steps;
    if (res.repeat !== null) b.repeat = res.repeat;
    if (res.via === 'ai') setStatus('✦ ' + (res.summary || 'Done.'), 'ai');
    else setStatus(res.note, 'warn');
    renderEditor();
    if ($('#aiStatus')) $('#aiStatus').textContent = res.via === 'ai' ? '✦ ' + (res.summary || 'Done.') : res.note;
    if ($('#aiStatus')) $('#aiStatus').className = 'ai-status ' + (res.via === 'ai' ? 'ai' : 'warn');
    buttonsChanged();
    preview(b);
  } catch (e) {
    if (e?.code !== 'cancelled') setStatus('Something went wrong. Try again.', 'warn');
    else setStatus('Stopped.');
  } finally {
    if ($('#bGen')) { $('#bGen').disabled = false; $('#bStop').hidden = true; }
  }
}
function setStatus(msg, cls = '') { const el = $('#aiStatus'); if (el) { el.textContent = msg; el.className = 'ai-status ' + cls; } }

// turn a button on so you can see what was just generated
function preview(b) {
  const st = inp(b);
  if (b.mode === 'toggle') { if (!st.on) press(b, st, simNow); else st.since = simNow; }
  else {
    st.held = false; st.lastRelease = -1e12;
    press(b, st, simNow);
    pendingRelease.set(b.id, simNow + Math.min(totalMs(b) * (b.repeat ? 2 : 1) + 600, 15000));
  }
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
      renderSteps(b); buttonsChanged();
    };
    el.querySelectorAll('.step-head button').forEach((x) => (x.onclick = () => {
      const a = x.dataset.a;
      if (a === 'del' && b.steps.length > 1) b.steps.splice(k, 1);
      if (a === 'dup') b.steps.splice(k + 1, 0, structuredClone(s));
      if (a === 'up' && k > 0) [b.steps[k - 1], b.steps[k]] = [b.steps[k], b.steps[k - 1]];
      renderSteps(b); buttonsChanged();
    }));

    const P = el.querySelector('.params');
    const add = (html, bind, cls) => { const l = document.createElement('label'); if (cls) l.className = cls; l.innerHTML = html; P.appendChild(l); bind(l); };
    add(`Length (s) <input type="number" min="0.05" step="0.05" value="${s.duration}">`, (l) => {
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
          i.oninput = () => { s[key] = fromHex(i.value); l.querySelector('.val').textContent = i.value; renderList(); renderBar(); save(); };
        });
      } else if (pd.type === 'range') {
        add(`${pd.label} <span class="val">${(+s[key]).toFixed(2)}</span><input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = +e.target.value; l.querySelector('.val').textContent = s[key].toFixed(2); save(); };
        });
      } else if (pd.type === 'int') {
        add(`${pd.label}<input type="number" min="${pd.min}" max="${pd.max}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = Math.max(pd.min, Math.min(pd.max, Math.round(+e.target.value || pd.min))); save(); };
        });
      } else if (pd.type === 'dir') {
        add(`${pd.label}<select>${Object.entries(DIRS).map(([id, n]) => `<option value="${id}" ${id === s[key] ? 'selected' : ''}>${n}</option>`).join('')}</select>`, (l) => {
          l.querySelector('select').onchange = (e) => { s[key] = e.target.value; save(); };
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

// animation loop
function tick(ts) {
  const dt = Math.min(100, ts - lastTs);
  lastTs = ts;
  simNow += dt * +$('#simSpeed').value;
  for (const [id, at] of pendingRelease) {
    if (simNow >= at) {
      const b = state.buttons.find((x) => x.id === id);
      if (b) release(b, inp(b), simNow);
      pendingRelease.delete(id);
    }
  }
  if ($('#tab-animate').classList.contains('active')) {
    const states = state.buttons.map(inp);
    const { colors, act } = renderScene(scene, state.buttons, states, simNow);
    drawLeds(sc, scene, colors, { pad: 36 });
    const sig = act.map((a) => (a ? 1 : 0)).join('');
    if (sig !== lastActiveSig) {
      lastActiveSig = sig;
      document.querySelectorAll('.pbtn').forEach((el, k) => el.classList.toggle('on', !!act[k]));
    }
    const b = selBtn(), k = state.sel;
    document.querySelectorAll('#steps .step').forEach((el) => el.classList.toggle('active', !!act[k] && act[k].step === b.steps[+el.dataset.k]));
  }
  requestAnimationFrame(tick);
}

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
  sketch = generateSketch(state.matrix, layout, state.buttons);
  $('#code').innerHTML = highlight(sketch);
  const n = layout.leds.length;
  const sides = state.matrix.lights === 'both' ? 2 : 1;
  $('#codeInfo').textContent = `taillight.ino · ${n} LEDs × ${sides} light${sides > 1 ? 's' : ''} · ${state.buttons.length} buttons · ${sketch.split('\n').length} lines`;
  const usage = [...pinUsage(state.matrix, state.buttons)].sort((a, b) => a[0] - b[0]);
  $('#pinTable').innerHTML = usage.map(([p, who]) => `<span class="p">GPIO ${p}</span><span class="w">${who.map((w) => String(w).replace(/[&<>]/g, '')).join(', ')}</span>`).join('');
  $('#codeWarn').innerHTML = warnHtml(pinProblems(state.matrix, state.buttons));
  const amps = (n * sides * 60) / 1000;
  $('#powerInfo').textContent = `Worst case (all white): ${amps.toFixed(1)} A. Code caps it at ${(state.matrix.maxMilliamps / 1000).toFixed(1)} A, so size your 5V supply for at least that.`;
}
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}
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
// start with the running lights on
const running = state.buttons.find((b) => /running|tail/i.test(b.name) && b.mode === 'toggle');
if (running) press(running, inp(running), 0);
syncBuildInputs();
syncHwInputs();
setView(state.view);
renderList();
renderBar();
renderEditor();
renderBuild();
renderOutputs();
requestAnimationFrame(tick);
