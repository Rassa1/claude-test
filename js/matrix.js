// LED matrix model: rows of LEDs with per-row count + horizontal offset,
// physical wiring order, and normalised (u,v) coordinates used by animations.

export function defaultMatrix() {
  return {
    ledsPerMeter: 60,
    rowLengthCm: 30,
    rowGapMm: 17,
    wiring: 'serpentine',      // 'serpentine' | 'progressive'
    start: 'top-left',         // first LED position
    dataPin: 5,
    ledType: 'WS2812B',
    colorOrder: 'GRB',
    maxMilliamps: 2000,
    outputs: [{ pinL: 5, pinR: 18 }],   // one data line per output, per light
    rows: Array.from({ length: 4 }, () => ({ count: 18, offset: 0, out: 0 })),
  };
}

export const pitchMm = (m) => 1000 / m.ledsPerMeter;

// Returns LEDs in physical (data-line) order.
export function computeLayout(m) {
  const pitch = pitchMm(m);
  const rowsPos = m.rows.map((r, ri) => {
    const arr = [];
    for (let c = 0; c < r.count; c++) {
      arr.push({ row: ri, col: c, x: r.offset + c * pitch, y: ri * m.rowGapMm });
    }
    return arr;
  });

  const fromBottom = m.start.startsWith('bottom');
  const fromRight = m.start.endsWith('right');
  const nOut = Math.max(1, (m.outputs || []).length);

  // Each output (data line) chains its own rows: starting at the chosen corner,
  // zig-zag or same-direction across those rows only.
  const leds = [];
  const outInfo = [];
  for (let oi = 0; oi < nOut; oi++) {
    const rowIdx = m.rows.map((r, i) => ((r.out ?? 0) >= nOut ? 0 : r.out ?? 0) === oi ? i : -1).filter((i) => i >= 0);
    if (fromBottom) rowIdx.reverse();
    const start = leds.length;
    rowIdx.forEach((ri, k) => {
      const arr = rowsPos[ri].slice();
      let rev = fromRight;
      if (m.wiring === 'serpentine' && k % 2 === 1) rev = !rev;
      if (rev) arr.reverse();
      arr.forEach((l) => { l.out = oi; l.oi = leds.length - start; leds.push(l); });
    });
    outInfo.push({ start, count: leds.length - start, rows: rowIdx.slice().sort((a, b) => a - b) });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of leds) {
    minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x);
    minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y);
  }
  if (!leds.length) { minX = maxX = minY = maxY = 0; }
  const w = maxX - minX || 1, h = maxY - minY || 1;
  leds.forEach((l, i) => {
    l.i = i;
    // quantised to 0..255 exactly as stored on the ESP32
    l.qu = Math.round(((l.x - minX) / w) * 255);
    l.qv = Math.round(((l.y - minY) / h) * 255);
    l.u = l.qu / 255;
    l.v = l.qv / 255;
  });
  return { leds, outInfo, minX, maxX, minY, maxY, pitch, rowCount: m.rows.length };
}

// Shape helpers -------------------------------------------------------------
export function applyShape(m, shape, amount = 0.5) {
  const pitch = pitchMm(m);
  const n = m.rows.length;
  const base = Math.max(1, Math.round((m.rowLengthCm / 100) * m.ledsPerMeter));
  m.rows.forEach((r, i) => {
    switch (shape) {
      case 'rect': r.count = base; r.offset = 0; break;
      case 'stagger': r.count = base; r.offset = i % 2 ? pitch / 2 : 0; break;
      case 'taper': {
        const lose = Math.round(i * amount * 2);
        r.count = Math.max(1, base - lose * 2);
        r.offset = lose * pitch;
        break;
      }
      case 'slant': r.count = base; r.offset = i * pitch * amount * 1.5; break;
      case 'arc': {
        const c = (i - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
        r.count = base; r.offset = c * c * pitch * 3 * amount; break;
      }
      case 'jitter': r.offset = Math.round((r.offset + (Math.random() - 0.5) * pitch * 2 * amount) * 10) / 10; break;
    }
  });
}

// Drawing --------------------------------------------------------------------
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { dpr, w, h };
}

export function viewTransform(canvas, layout, pad = 40) {
  const { w, h } = fitCanvas(canvas);
  const p = layout.pitch;
  const bw = layout.maxX - layout.minX + p * 2;
  const bh = layout.maxY - layout.minY + p * 2;
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = (w - bw * s) / 2 + p * s - layout.minX * s;
  const oy = (h - bh * s) / 2 + p * s - layout.minY * s;
  return { s, ox, oy, toScreen: (x, y) => [ox + x * s, oy + y * s], toWorld: (sx, sy) => [(sx - ox) / s, (sy - oy) / s] };
}

const OUT_HUES = [200, 35, 130, 290, 0, 60, 170, 320];
export function outColor(k, a = 1) { return `hsla(${OUT_HUES[k % OUT_HUES.length]}, 75%, 62%, ${a})`; }

// colors: array of [r,g,b] in physical order, or null for the "unlit" builder look.
export function drawLeds(canvas, layout, colors, opts = {}) {
  const ctx = canvas.getContext('2d');
  const { dpr, w, h } = fitCanvas(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!layout.leds.length) return null;
  const vt = viewTransform(canvas, layout, opts.pad ?? 40);
  const r = Math.max(1.5, Math.min(layout.pitch * vt.s * 0.36, 14));

  if (opts.showWiring) {
    ctx.lineWidth = 1.5;
    let prevOut = -1;
    ctx.beginPath();
    for (const l of layout.leds) {
      const [x, y] = vt.toScreen(l.x, l.y);
      if (l.out !== prevOut) {
        ctx.stroke();
        ctx.strokeStyle = outColor(l.out ?? 0, 0.55);
        ctx.beginPath(); ctx.moveTo(x, y);
        prevOut = l.out;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // LED bodies
  for (const l of layout.leds) {
    const [x, y] = vt.toScreen(l.x, l.y);
    const hi = opts.highlightRow === l.row;
    ctx.fillStyle = hi ? '#3a3f4d' : '#22252d';
    ctx.strokeStyle = hi ? '#ff5a4f' : opts.showWiring && l.out !== undefined ? outColor(l.out, 0.6) : '#363a45';
    ctx.lineWidth = hi ? 1.5 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // first LED of each data line
  if (opts.showWiring) {
    ctx.font = '600 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const l of layout.leds) {
      if (l.oi !== 0 || l.out === undefined) continue;
      const [x, y] = vt.toScreen(l.x, l.y);
      ctx.fillStyle = outColor(l.out, 1);
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(opts.outLabel ? opts.outLabel(l.out) : 'OUT ' + (l.out + 1), x, y - r - 3);
    }
  }

  if (colors) {
    ctx.globalCompositeOperation = 'lighter';
    for (const l of layout.leds) {
      const c = colors[l.i];
      if (!c || c[0] + c[1] + c[2] < 3) continue;
      const [x, y] = vt.toScreen(l.x, l.y);
      const lum = Math.max(c[0], c[1], c[2]) / 255;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.55 * lum + 0.1})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      // hot core
      const wr = Math.min(255, c[0] + 90 * lum), wg = Math.min(255, c[1] + 90 * lum), wb = Math.min(255, c[2] + 90 * lum);
      ctx.fillStyle = `rgb(${wr | 0},${wg | 0},${wb | 0})`;
      ctx.beginPath(); ctx.arc(x, y, r * 0.85, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  if (opts.showIndex && r > 7) {
    ctx.fillStyle = '#8a92a6';
    ctx.font = `${Math.min(10, r)}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of layout.leds) {
      const [x, y] = vt.toScreen(l.x, l.y);
      ctx.fillText(l.i, x, y);
    }
  }
  return vt;
}
