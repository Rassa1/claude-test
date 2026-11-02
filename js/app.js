import { defaultMatrix, computeLayout, applyShape, drawLeds, viewTransform, pitchMm } from './matrix.js';
import { ANIMS, PARAMS, DIRS, defaultParams, defaultDuration, renderFrame } from './animations.js';
import { parseDescription, EXAMPLES } from './parser.js';
import { generateSketch } from './codegen.js';

const $ = (s) => document.querySelector(s);
const STORE = 'taillight-studio-v1';

// ---------------------------------------------------------------- state
let state = load() || {
  matrix: defaultMatrix(),
  prompt: EXAMPLES[0],
  steps: parseDescription(EXAMPLES[0]),
};
let layout = computeLayout(state.matrix);
let selRow = -1;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }, 200);
}
function matrixChanged() {
  layout = computeLayout(state.matrix);
  renderBuild();
  save();
}

// ---------------------------------------------------------------- tabs
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'build') renderBuild();
  if (name === 'animate') { renderTimeline(); }
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
      <button class="x" title="Remove row">×</button>`;
    const [cnt, off] = d.querySelectorAll('input');
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
bc.addEventListener('pointerup', () => { if (drag) { drag = null; renderRowTable(); save(); } });

// ---------------------------------------------------------------- animate
const sc = $('#simCanvas');
let playing = true, simTime = 0, lastTs = performance.now();
const totalDur = () => state.steps.reduce((a, s) => a + s.duration, 0);

$('#prompt').value = state.prompt;
$('#generate').onclick = () => {
  state.prompt = $('#prompt').value;
  const steps = parseDescription(state.prompt);
  if (steps.length) state.steps = steps;
  simTime = 0; renderSteps(); renderTimeline(); save();
};
$('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#generate').click(); });
EXAMPLES.forEach((ex) => {
  const b = document.createElement('button');
  b.textContent = ex;
  b.onclick = () => { $('#prompt').value = ex; $('#generate').click(); };
  $('#examples').appendChild(b);
});

const toHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));

function renderSteps() {
  const root = $('#steps');
  root.innerHTML = '';
  state.steps.forEach((s, k) => {
    const def = ANIMS[s.type];
    const el = document.createElement('div');
    el.className = 'step';
    el.dataset.k = k;
    const opts = Object.entries(ANIMS).map(([id, a]) => `<option value="${id}" ${id === s.type ? 'selected' : ''}>${a.name}</option>`).join('');
    el.innerHTML = `<div class="step-head"><span class="num">${k + 1}</span><select>${opts}</select>
      <button data-a="up" title="Move up">↑</button><button data-a="dup" title="Duplicate">⧉</button><button data-a="del" title="Delete">×</button></div>
      <div class="step-desc">${def.desc}</div><div class="params"></div>`;
    el.querySelector('select').onchange = (e) => {
      const keep = { duration: s.duration, brightness: s.brightness };
      const fresh = { type: e.target.value, ...defaultParams(e.target.value) };
      if (s.color) fresh.color = s.color;
      Object.assign(s, fresh, keep);
      for (const key of Object.keys(s)) if (!(key in fresh) && !(key in keep)) delete s[key];
      s.duration = defaultDuration(s);
      changedSteps(true);
    };
    el.querySelectorAll('.step-head button').forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'del' && state.steps.length > 1) state.steps.splice(k, 1);
      if (a === 'dup') state.steps.splice(k + 1, 0, structuredClone(s));
      if (a === 'up' && k > 0) [state.steps[k - 1], state.steps[k]] = [state.steps[k], state.steps[k - 1]];
      changedSteps(true);
    }));

    const P = el.querySelector('.params');
    const add = (html, bind) => { const l = document.createElement('label'); l.innerHTML = html; P.appendChild(l); bind(l); };
    add(`Length (s) <input type="number" min="0.05" step="0.05" value="${s.duration}">`, (l) => {
      l.querySelector('input').oninput = (e) => { s.duration = Math.max(0.05, +e.target.value || 0.05); changedSteps(); };
    });
    add(`Brightness <span class="val">${Math.round(s.brightness * 100)}%</span><input type="range" min="0.02" max="1" step="0.01" value="${s.brightness}">`, (l) => {
      l.querySelector('input').oninput = (e) => { s.brightness = +e.target.value; l.querySelector('.val').textContent = Math.round(s.brightness * 100) + '%'; changedSteps(); };
    });
    for (const key of def.uses) {
      const pd = PARAMS[key];
      if (pd.type === 'color') {
        add(`${pd.label}<div class="colorrow"><input type="color" value="${toHex(s[key])}"><span class="val">${toHex(s[key])}</span></div>`, (l) => {
          const i = l.querySelector('input');
          i.oninput = () => { s[key] = fromHex(i.value); l.querySelector('.val').textContent = i.value; changedSteps(); };
        });
      } else if (pd.type === 'range') {
        add(`${pd.label} <span class="val">${(+s[key]).toFixed(2)}</span><input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = +e.target.value; l.querySelector('.val').textContent = s[key].toFixed(2); changedSteps(); };
        });
      } else if (pd.type === 'int') {
        add(`${pd.label}<input type="number" min="${pd.min}" max="${pd.max}" value="${s[key]}">`, (l) => {
          l.querySelector('input').oninput = (e) => { s[key] = Math.max(pd.min, Math.min(pd.max, Math.round(+e.target.value || pd.min))); changedSteps(); };
        });
      } else if (pd.type === 'dir') {
        add(`${pd.label}<select>${Object.entries(DIRS).map(([id, n]) => `<option value="${id}" ${id === s[key] ? 'selected' : ''}>${n}</option>`).join('')}</select>`, (l) => {
          l.querySelector('select').onchange = (e) => { s[key] = e.target.value; changedSteps(); };
        });
      }
    }
    root.appendChild(el);
  });
}
function changedSteps(rebuild) {
  if (rebuild) renderSteps();
  renderTimeline(); save();
}
$('#addStep').onclick = () => {
  const s = { type: 'solid', ...defaultParams('solid') };
  s.duration = defaultDuration(s);
  state.steps.push(s); changedSteps(true);
};

const STEP_COLORS = (s) => {
  if (s.type === 'rainbow') return 'linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#93f)';
  if (s.type === 'off') return '#222';
  const c = s.color || [80, 80, 80];
  return `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
};
function renderTimeline() {
  const tl = $('#timeline');
  tl.querySelectorAll('.seg').forEach((e) => e.remove());
  const tot = totalDur();
  state.steps.forEach((s, k) => {
    const d = document.createElement('div');
    d.className = 'seg';
    d.style.width = (s.duration / tot) * 100 + '%';
    d.style.background = STEP_COLORS(s);
    d.textContent = `${k + 1}. ${ANIMS[s.type].name}`;
    tl.insertBefore(d, $('#playhead'));
  });
}
$('#timeline').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  simTime = ((e.clientX - r.left) / r.width) * totalDur();
};
$('#play').onclick = () => { playing = !playing; $('#play').textContent = playing ? '❚❚' : '▶'; };
$('#restart').onclick = () => { simTime = 0; };

let activeStep = -1;
function tick(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if ($('#tab-animate').classList.contains('active')) {
    if (playing) simTime += dt * +$('#simSpeed').value;
    const tot = totalDur();
    const tc = tot ? simTime % tot : 0;
    const colors = renderFrame(layout, state.steps, tc);
    drawLeds(sc, layout, colors, { pad: 50 });
    $('#playhead').style.left = (tot ? (tc / tot) * 100 : 0) + '%';
    $('#clock').textContent = tc.toFixed(2) + 's';
    let acc = 0, k = 0;
    for (; k < state.steps.length - 1; k++) { if (tc < acc + state.steps[k].duration) break; acc += state.steps[k].duration; }
    if (k !== activeStep) {
      activeStep = k;
      document.querySelectorAll('.step').forEach((e) => e.classList.toggle('active', +e.dataset.k === k));
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- code
let sketch = '';
function syncHwInputs() {
  const m = state.matrix;
  $('#dataPin').value = m.dataPin; $('#ledType').value = m.ledType;
  $('#colorOrder').value = m.colorOrder; $('#maxMa').value = m.maxMilliamps;
}
[['#dataPin', 'dataPin', true], ['#ledType', 'ledType'], ['#colorOrder', 'colorOrder'], ['#maxMa', 'maxMilliamps', true]].forEach(([sel, key, isNum]) => {
  $(sel).addEventListener('input', (e) => { state.matrix[key] = isNum ? +e.target.value : e.target.value; save(); renderCode(); });
});
function highlight(src) {
  const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(#\w+)|\b(static|const|inline|float|int|bool|void|return|uint8_t|uint32_t|if|else|while|for|switch|case|default|CRGB)\b|\b(\d+(?:\.\d+)?f?u?)\b/g,
    (m, c, p, k, n) => c ? `<span class="c">${c}</span>` : p ? `<span class="p">${p}</span>` : k ? `<span class="k">${k}</span>` : `<span class="n">${n}</span>`);
}
function renderCode() {
  sketch = generateSketch(state.matrix, layout, state.steps);
  $('#code').innerHTML = highlight(sketch);
  const n = layout.leds.length;
  $('#codeInfo').textContent = `taillight.ino · ${n} LEDs · ${state.steps.length} step${state.steps.length > 1 ? 's' : ''} · ${sketch.split('\n').length} lines`;
  const amps = (n * 60) / 1000;
  $('#powerInfo').textContent = `Worst case (all white): ${amps.toFixed(1)} A. Code caps it at ${(state.matrix.maxMilliamps / 1000).toFixed(1)} A – size your 5V supply for at least that.`;
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
$('#download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sketch], { type: 'text/plain' }));
  a.download = 'taillight.ino';
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------------------------------------------------------------- boot
window.addEventListener('resize', () => { if ($('#tab-build').classList.contains('active')) renderBuild(); });
syncBuildInputs();
syncHwInputs();
renderSteps();
renderTimeline();
renderBuild();
requestAnimationFrame(tick);
