// Button / layer engine shared by the simulator. The generated ESP32 sketch
// implements the same rules (see codegen.js).
import { ANIMS } from './animations.js';

export const SIDE_MASK = { left: 1, right: 2, both: 3 };

// Build the on-screen scene: one or two lights. The right light is the mirror
// image of the left one (same wiring order, mirrored positions).
export function buildScene(layout, view) {
  const sides = view === 'both' ? [0, 1] : view === 'right' ? [1] : [0];
  const w = layout.maxX - layout.minX;
  const gap = Math.max(w * 0.7, layout.pitch * 6);
  const n = layout.leds.length;
  const leds = [];
  for (const side of sides) {
    for (const L of layout.leds) {
      const qu = side ? 255 - L.qu : L.qu;
      const mirroredX = layout.minX + layout.maxX - L.x;
      const x = side ? (sides.length === 2 ? mirroredX + w + gap : mirroredX) : L.x;
      leds.push({
        x, y: L.y, row: L.row, side, i: leds.length,
        a: { i: L.i, n, side, u: qu / 255, v: L.v, o: (255 - L.qu) / 255 },
      });
    }
  }
  let minX = Infinity, maxX = -Infinity;
  for (const l of leds) { minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x); }
  return { leds, sides, minX, maxX, minY: layout.minY, maxY: layout.maxY, pitch: layout.pitch };
}

export const totalMs = (btn) => btn.steps.reduce((a, s) => a + Math.max(1, Math.round(s.duration * 1000)), 0);

// Which step is playing and how far into it (ms -> {k, t seconds})
export function stepAt(btn, elapsedMs) {
  const durs = btn.steps.map((s) => Math.max(1, Math.round(s.duration * 1000)));
  const tot = durs.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  const cyc = btn.repeat ? elapsedMs % tot : Math.min(elapsedMs, tot - 1);
  let k = 0, start = 0;
  while (k < durs.length - 1 && cyc >= start + durs[k]) { start += durs[k]; k++; }
  return { k, t: (cyc - start) / 1000, cyc, tot };
}

// ---- input state machine (mirrors the C++ one) ----
export function newInputState() { return { held: false, on: false, since: 0, lastRelease: -1e12 }; }

export function press(btn, st, now) {
  if (btn.mode === 'toggle') {
    st.on = !st.on;
    if (st.on) st.since = now;
  } else {
    if (!isActive(btn, st, now)) st.since = now;
    st.held = true;
  }
}
export function release(btn, st, now) {
  if (btn.mode !== 'toggle' && st.held) { st.held = false; st.lastRelease = now; }
}
export function isActive(btn, st, now) {
  if (btn.mode === 'toggle') return st.on;
  return st.held || now - st.lastRelease < (btn.releaseMs || 0);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Render every LED in the scene. buttons are ordered highest priority first.
export function renderScene(scene, buttons, states, now) {
  const out = new Array(scene.leds.length);
  const act = buttons.map((b, k) => {
    if (!isActive(b, states[k], now) || !b.steps.length) return null;
    const sa = stepAt(b, now - states[k].since);
    if (!sa) return null;
    const step = b.steps[sa.k];
    return { b, step, t: sa.t, def: ANIMS[step.type] || ANIMS.off, mask: SIDE_MASK[b.side] || 3 };
  });
  for (const l of scene.leds) {
    let c = [0, 0, 0];
    for (let k = buttons.length - 1; k >= 0; k--) {
      const a = act[k];
      if (!a || !(a.mask & (1 << l.side))) continue;
      const raw = a.def.js(a.step, l.a, a.t);
      const br = a.step.brightness;
      const x = [
        Math.round(clamp01(raw[0] / 255 * br) * 255),
        Math.round(clamp01(raw[1] / 255 * br) * 255),
        Math.round(clamp01(raw[2] / 255 * br) * 255),
      ];
      if (a.b.layer !== 'overlay' || x[0] || x[1] || x[2]) c = x;
    }
    out[l.i] = c;
  }
  return { colors: out, act };
}
