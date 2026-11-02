// Animation library. Every animation is implemented twice with identical math:
//   js(p, L, t)  -> { k, c } or [r,g,b]   (browser simulation)
//   cpp(p)       -> C++ statements        (ESP32 / FastLED sketch)
// Inputs: u,v = LED position (0..1, left->right, top->bottom), i = LED index,
// t = seconds since this step started, pos = position along chosen direction.

import { compileCustom, hash32 } from './custom.js';

export const DIRS = {
  outer: 'Inner → Outer edge',
  inner: 'Outer → Inner edge',
  ltr: 'Left → Right',
  rtl: 'Right → Left',
  out: 'Center → Out',
  in: 'Edges → In',
  up: 'Bottom → Top',
  down: 'Top → Bottom',
};

export function posJS(dir, L) {
  const u = L.u, v = L.v;
  switch (dir) {
    case 'outer': return L.o;
    case 'inner': return 1 - L.o;
    case 'rtl': return 1 - u;
    case 'out': return Math.abs(u - 0.5) * 2;
    case 'in': return 1 - Math.abs(u - 0.5) * 2;
    case 'up': return 1 - v;
    case 'down': return v;
    default: return u;
  }
}
export function posCPP(dir) {
  switch (dir) {
    case 'outer': return 'o';
    case 'inner': return '1.0f - o';
    case 'rtl': return '1.0f - u';
    case 'out': return 'fabsf(u - 0.5f) * 2.0f';
    case 'in': return '1.0f - fabsf(u - 0.5f) * 2.0f';
    case 'up': return '1.0f - v';
    case 'down': return 'v';
    default: return 'u';
  }
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fract = (x) => x - Math.floor(x);
const hue = (h) => [
  clamp01(Math.abs(h * 6 - 3) - 1) * 255,
  clamp01(2 - Math.abs(h * 6 - 2)) * 255,
  clamp01(2 - Math.abs(h * 6 - 4)) * 255,
];
const mix = (a, b, m) => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
const f = (x) => {
  const s = (+x).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  return s + 'f';
};
const rgb = (c) => `${c[0]}, ${c[1]}, ${c[2]}`;
const TAU = Math.PI * 2;

// Param definitions used by the step editor
export const PARAMS = {
  color: { type: 'color', label: 'Color' },
  color2: { type: 'color', label: 'Second color' },
  period: { type: 'range', label: 'Speed (cycle s)', min: 0.05, max: 5, step: 0.01 },
  dir: { type: 'dir', label: 'Direction' },
  width: { type: 'range', label: 'Width', min: 0.02, max: 1, step: 0.01 },
  count: { type: 'int', label: 'Count', min: 1, max: 20 },
  flashes: { type: 'int', label: 'Flashes', min: 1, max: 10 },
  trail: { type: 'range', label: 'Background glow', min: 0, max: 0.5, step: 0.01 },
  code: { type: 'code', label: 'Formula' },
};

const cache = new Map();
export function compiled(code) {
  if (cache.has(code)) return cache.get(code);
  let c = null;
  try { c = compileCustom(code); } catch { c = null; }
  if (cache.size > 200) cache.clear();
  cache.set(code, c);
  return c;
}

export const ANIMS = {
  solid: {
    name: 'Solid',
    desc: 'Steady color (e.g. running/tail light).',
    uses: ['color'],
    js: (p) => p.color,
    cpp: (p) => `return shade(${rgb(p.color)}, BR);`,
  },
  off: {
    name: 'Off / pause',
    desc: 'All LEDs off.',
    uses: [],
    js: () => [0, 0, 0],
    cpp: () => `return CRGB::Black;`,
  },
  sequential: {
    name: 'Sequential sweep',
    desc: 'Fills across, holds, then clears – the classic Audi-style turn signal.',
    uses: ['color', 'period', 'dir', 'trail'],
    js: (p, L, t) => {
      const pos = posJS(p.dir, L);
      const ph = fract(t / p.period);
      const fill = ph < 0.6 ? ph / 0.6 : ph < 0.85 ? 2 : -1;
      return pos <= fill ? p.color : mix([0, 0, 0], p.color, p.trail);
    },
    cpp: (p) => `float pos = ${posCPP(p.dir)};
  float ph = fractf(t / ${f(p.period)});
  float fill = ph < 0.6f ? ph / 0.6f : (ph < 0.85f ? 2.0f : -1.0f);
  return shade(${rgb(p.color)}, (pos <= fill ? 1.0f : ${f(p.trail)}) * BR);`,
  },
  blink: {
    name: 'Blink / hazard',
    desc: 'All LEDs flash on and off.',
    uses: ['color', 'period', 'trail'],
    js: (p, L, t) => (fract(t / p.period) < 0.5 ? p.color : mix([0, 0, 0], p.color, p.trail)),
    cpp: (p) => `return shade(${rgb(p.color)}, (fractf(t / ${f(p.period)}) < 0.5f ? 1.0f : ${f(p.trail)}) * BR);`,
  },
  brake: {
    name: 'Brake flash',
    desc: 'Rapid flashes, then stays solid.',
    uses: ['color', 'period', 'flashes'],
    js: (p, L, t) => {
      const on = t < p.flashes * p.period ? fract(t / p.period) < 0.5 : true;
      return on ? p.color : [0, 0, 0];
    },
    cpp: (p) => `bool on = t < ${f(p.flashes * p.period)} ? (fractf(t / ${f(p.period)}) < 0.5f) : true;
  return shade(${rgb(p.color)}, on ? BR : 0.0f);`,
  },
  scanner: {
    name: 'Scanner (Knight Rider)',
    desc: 'A glowing bar bouncing back and forth.',
    uses: ['color', 'period', 'dir', 'width', 'trail'],
    js: (p, L, t) => {
      const pos = posJS(p.dir, L);
      const ph = fract(t / p.period);
      const s = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const k = Math.max(p.trail, clamp01(1 - Math.abs(pos - s) / p.width));
      return mix([0, 0, 0], p.color, k);
    },
    cpp: (p) => `float pos = ${posCPP(p.dir)};
  float ph = fractf(t / ${f(p.period)});
  float s = ph < 0.5f ? ph * 2.0f : 2.0f - ph * 2.0f;
  float k = fmaxf(${f(p.trail)}, clamp01(1.0f - fabsf(pos - s) / ${f(p.width)}));
  return shade(${rgb(p.color)}, k * BR);`,
  },
  breathe: {
    name: 'Breathe / pulse',
    desc: 'Smoothly fades in and out.',
    uses: ['color', 'period'],
    js: (p, L, t) => mix([0, 0, 0], p.color, 0.05 + 0.95 * (0.5 - 0.5 * Math.cos(TAU * t / p.period))),
    cpp: (p) => `float k = 0.05f + 0.95f * (0.5f - 0.5f * cosf(TWO_PI_F * t / ${f(p.period)}));
  return shade(${rgb(p.color)}, k * BR);`,
  },
  chase: {
    name: 'Chase',
    desc: 'Dots running along the lights.',
    uses: ['color', 'color2', 'period', 'dir', 'count'],
    js: (p, L, t) => {
      const pos = posJS(p.dir, L);
      const k = Math.pow(0.5 + 0.5 * Math.cos(TAU * (pos * p.count - t / p.period)), 4);
      return mix(p.color2, p.color, k);
    },
    cpp: (p) => `float pos = ${posCPP(p.dir)};
  float k = powf(0.5f + 0.5f * cosf(TWO_PI_F * (pos * ${f(p.count)} - t / ${f(p.period)})), 4.0f);
  return mix2(${rgb(p.color2)}, ${rgb(p.color)}, k, BR);`,
  },
  wave: {
    name: 'Color wave',
    desc: 'Two colors flowing through each other.',
    uses: ['color', 'color2', 'period', 'dir', 'count'],
    js: (p, L, t) => {
      const pos = posJS(p.dir, L);
      return mix(p.color, p.color2, 0.5 + 0.5 * Math.sin(TAU * (pos * p.count - t / p.period)));
    },
    cpp: (p) => `float pos = ${posCPP(p.dir)};
  float m = 0.5f + 0.5f * sinf(TWO_PI_F * (pos * ${f(p.count)} - t / ${f(p.period)}));
  return mix2(${rgb(p.color)}, ${rgb(p.color2)}, m, BR);`,
  },
  rainbow: {
    name: 'Rainbow',
    desc: 'Scrolling rainbow (show only – not road legal!).',
    uses: ['period', 'dir', 'count'],
    js: (p, L, t) => hue(fract(posJS(p.dir, L) * p.count - t / p.period)),
    cpp: (p) => `float pos = ${posCPP(p.dir)};
  return hueColor(fractf(pos * ${f(p.count)} - t / ${f(p.period)}), BR);`,
  },
  custom: {
    name: 'Custom (AI formula)',
    desc: 'A formula written by AI (or you). Runs identically in the simulator and on the ESP32.',
    uses: ['code'],
    js: (p, L, t) => {
      const c = compiled(p.code);
      if (!c) return [0, 0, 0];
      const [r, g, b] = c.js(L, t);
      return [r * 255, g * 255, b * 255];
    },
    cpp: (p) => {
      const c = compiled(p.code);
      if (!c) return 'return CRGB::Black;';
      return `${c.cpp}
  return CRGB((uint8_t)(clamp01(r * BR) * 255.0f + 0.5f), (uint8_t)(clamp01(g * BR) * 255.0f + 0.5f), (uint8_t)(clamp01(b * BR) * 255.0f + 0.5f));`;
    },
  },
  sparkle: {
    name: 'Sparkle',
    desc: 'Random twinkles over a dim base color.',
    uses: ['color', 'color2', 'width', 'trail'],
    js: (p, L, t) => {
      const frame = Math.floor(t * 20);
      const on = hash32(L.i, frame) % 1000 < p.width * 300;
      return on ? p.color2 : mix([0, 0, 0], p.color, p.trail);
    },
    cpp: (p) => `uint32_t frame = (uint32_t)(t * 20.0f);
  bool on = (hash32((uint32_t)i, frame) % 1000u) < ${Math.round(p.width * 300)}u;
  if (on) return shade(${rgb(p.color2)}, BR);
  return shade(${rgb(p.color)}, ${f(p.trail)} * BR);`,
  },
};

export function defaultParams(type) {
  const base = {
    color: [255, 0, 0], color2: [255, 255, 255], period: 1, dir: 'ltr',
    width: 0.2, count: 3, flashes: 3, trail: 0, brightness: 1,
  };
  const t = {
    sequential: { color: [255, 110, 0], period: 0.8, dir: 'outer' },
    blink: { color: [255, 110, 0], period: 0.8 },
    brake: { period: 0.12, flashes: 4 },
    scanner: { period: 1.6, width: 0.15, trail: 0.03 },
    breathe: { period: 2 },
    chase: { color2: [20, 0, 0], period: 1.2 },
    wave: { color2: [255, 110, 0], period: 2, count: 1 },
    rainbow: { period: 3, count: 1 },
    sparkle: { color2: [255, 255, 255], width: 0.15, trail: 0.25 },
    solid: { brightness: 0.4 },
    custom: { code: 'float w = tri(o * 2 - t * 0.5);\nr = w;\ng = w * 0.1;' },
  }[type] || {};
  return { ...base, ...t };
}

// Default length of one step (seconds) if the user doesn't say "for N seconds"
export function defaultDuration(s) {
  switch (s.type) {
    case 'sequential': return +(s.period * 3).toFixed(2);
    case 'brake': return +(s.flashes * s.period + 1.5).toFixed(2);
    case 'blink': return +(s.period * 4).toFixed(2);
    case 'off': return 1;
    default: return 4;
  }
}


export const fmtF = f;
