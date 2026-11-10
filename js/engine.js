// Inputs + effects engine. The generated ESP32 sketch implements exactly the
// same rules (see codegen.js), frame by frame.
//
// INPUT  = a wire into the ESP32 (running-light power, brake, left blinker...).
//   type 'level':  on while the signal is present, plus `holdMs` after it drops
//                  (so a pulsing blinker wire reads as one continuous "on").
//   type 'toggle': a push button; each press flips it on/off.
// EFFECT = an animation with a trigger built from inputs:
//   cond:  each input can be required ON, required OFF, or ignored; match all / any.
//   kind 'while': runs while the condition is true (restarts each time it turns on).
//   kind 'once':  plays its steps once when the condition turns on, but only if the
//                 condition had been off for at least `minOffMs` (or never been on).
import { ANIMS } from './animations.js';

export const SIDE_MASK = { left: 1, right: 2, both: 3 };
// light width measured in LED spacings (used by the text effect); rounded so JS and C++ agree
export const lightCols = (layout) => +((layout.maxX - layout.minX) / layout.pitch).toFixed(4);

// ---------------------------------------------------------------- scene
// One or two lights. The right light is the mirror image of the left one.
export function buildScene(layout, view, pair = true) {
  const sides = view === 'both' ? [0, 1] : view === 'right' ? [1] : [0];
  const w = layout.maxX - layout.minX;
  const gap = Math.max(w * 0.7, layout.pitch * 6);
  const n = layout.leds.length;
  const wc = lightCols(layout), nr = layout.rowCount || 1;
  const leds = [];
  for (const side of sides) {
    for (const L of layout.leds) {
      const qu = side ? 255 - L.qu : L.qu;
      const mirroredX = layout.minX + layout.maxX - L.x;
      const x = side ? (sides.length === 2 ? mirroredX + w + gap : mirroredX) : L.x;
      leds.push({
        x, y: L.y, row: L.row, side, i: leds.length,
        a: { i: L.i, n, side, u: qu / 255, v: L.v, o: (255 - L.qu) / 255, wc, nr, pair },
      });
    }
  }
  let minX = Infinity, maxX = -Infinity;
  for (const l of leds) { minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x); }
  return { leds, sides, minX, maxX, minY: layout.minY, maxY: layout.maxY, pitch: layout.pitch };
}

export const stepMs = (s) => Math.max(1, Math.round(s.duration * 1000));
export const totalMs = (fx) => fx.steps.reduce((a, s) => a + stepMs(s), 0);

// Which step is playing and how far into it
export function stepAt(fx, elapsedMs) {
  const durs = fx.steps.map(stepMs);
  const tot = durs.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  const loop = fx.trigger.kind !== 'once' && fx.repeat;
  const cyc = loop ? elapsedMs % tot : Math.min(elapsedMs, tot - 1);
  let k = 0, start = 0;
  while (k < durs.length - 1 && cyc >= start + durs[k]) { start += durs[k]; k++; }
  return { k, t: (cyc - start) / 1000 };
}

// ---------------------------------------------------------------- inputs
export function newInputState() { return { raw: false, on: false, lastOn: 0, everOn: false }; }

// raw = is the signal present right now (already debounced)
export function updateInput(input, st, raw, now) {
  if (input.type === 'toggle') {
    if (raw && !st.raw) st.on = !st.on;
  } else {
    if (raw) { st.lastOn = now; st.everOn = true; }
    st.on = raw || (st.everOn && now - st.lastOn < (input.holdMs | 0));
  }
  st.raw = raw;
  return st.on;
}

// ---------------------------------------------------------------- effects
export function condMasks(fx, inputs) {
  let needOn = 0, needOff = 0;
  inputs.forEach((inp, k) => {
    const c = fx.trigger.conds[inp.id];
    if (c === 'on') needOn |= 1 << k;
    if (c === 'off') needOff |= 1 << k;
  });
  return { needOn: needOn >>> 0, needOff: needOff >>> 0 };
}
export function evalCond(fx, masks, onMask) {
  const { needOn, needOff } = masks;
  if (!needOn && !needOff) return false;
  if (fx.trigger.match === 'any') return !!((onMask & needOn) || (~onMask & needOff));
  return (onMask & needOn) === needOn && (onMask & needOff) === 0;
}
export function newEffectState() { return { prev: false, active: false, since: 0, offSince: 0, everOn: false }; }

export function updateEffect(fx, st, cond, now) {
  const t = fx.trigger;
  if (t.kind === 'always') cond = true;          // runs whenever the ESP is powered
  if (t.kind === 'once') {
    if (cond && !st.prev) {
      if (!st.everOn || now - st.offSince >= (t.minOffMs | 0)) { st.active = true; st.since = now; }
      st.everOn = true;
    }
    if (!cond && st.prev) st.offSince = now;
    if (st.active && t.cancel && !cond) st.active = false;
    if (st.active && now - st.since >= totalMs(fx)) st.active = false;
  } else {
    if (cond && !st.prev) st.since = now;
    st.active = cond;
  }
  st.prev = cond;
  return st.active;
}

// One full engine tick: raw input signals -> effect states. Mutates the state arrays.
export function engineStep(model, inStates, fxStates, raws, now) {
  let onMask = 0;
  model.inputs.forEach((inp, k) => { if (updateInput(inp, inStates[k], !!raws[k], now)) onMask |= 1 << k; });
  model.effects.forEach((fx, k) => {
    updateEffect(fx, fxStates[k], evalCond(fx, condMasks(fx, model.inputs), onMask), now);
  });
  return onMask >>> 0;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Render every LED. Effects are ordered highest priority first.
export function renderScene(scene, effects, fxStates, now) {
  const out = new Array(scene.leds.length);
  const act = effects.map((fx, k) => {
    const st = fxStates[k];
    if (!st.active || !fx.steps.length) return null;
    const sa = stepAt(fx, now - st.since);
    if (!sa) return null;
    const step = fx.steps[sa.k];
    return { fx, step, t: sa.t, def: ANIMS[step.type] || ANIMS.off, mask: SIDE_MASK[fx.side] || 3 };
  });
  for (const l of scene.leds) {
    let c = [0, 0, 0];
    for (let k = effects.length - 1; k >= 0; k--) {
      const a = act[k];
      if (!a || !(a.mask & (1 << l.side))) continue;
      const raw = a.def.js(a.step, l.a, a.t);
      const br = a.step.brightness;
      const x = [
        Math.round(clamp01(raw[0] / 255 * br) * 255),
        Math.round(clamp01(raw[1] / 255 * br) * 255),
        Math.round(clamp01(raw[2] / 255 * br) * 255),
      ];
      if (a.fx.layer !== 'overlay' || x[0] || x[1] || x[2]) c = x;
    }
    out[l.i] = c;
  }
  return { colors: out, act };
}
