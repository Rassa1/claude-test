// "Custom" animations: a tiny formula language that compiles to BOTH JavaScript
// (simulator) and C++ (ESP32), so AI-written effects run identically on both.
//
//   float x = fract(o * 3 - t);       // declare a local
//   r = step(0.5, x); g = r * 0.4;    // assign outputs r, g, b (0..1)
//
// Inputs: u, v (0..1 position in the light, left->right / top->bottom as seen
// from behind), o (0 = inner edge near the car's center, 1 = outer edge),
// t (seconds since step start), i (LED index), n (LED count), side (0 left, 1 right), PI.

export const FUNCS = {
  sin: ['Math.sin', 'sinf', 1], cos: ['Math.cos', 'cosf', 1], abs: ['Math.abs', 'fabsf', 1],
  floor: ['Math.floor', 'floorf', 1], sqrt: ['Math.sqrt', 'sqrtf', 1], exp: ['Math.exp', 'expf', 1],
  pow: ['Math.pow', 'powf', 2], min: ['Math.min', 'fminf', 2], max: ['Math.max', 'fmaxf', 2],
  fract: ['FX.fract', 'fx_fract', 1], clamp: ['FX.clamp', 'fx_clamp', 3], clamp01: ['FX.clamp01', 'clamp01', 1],
  mix: ['FX.mix', 'fx_mix', 3], step: ['FX.step', 'fx_step', 2], smooth: ['FX.smooth', 'fx_smooth', 3],
  rnd: ['FX.rnd', 'fx_rnd', 2], tri: ['FX.tri', 'fx_tri', 1],
  hueR: ['FX.hueR', 'fx_hueR', 1], hueG: ['FX.hueG', 'fx_hueG', 1], hueB: ['FX.hueB', 'fx_hueB', 1],
};
const INPUTS = ['u', 'v', 'o', 't', 'i', 'n', 'side', 'PI'];
const OUTPUTS = ['r', 'g', 'b'];
const RESERVED = new Set([...INPUTS, ...Object.keys(FUNCS), 'float', 'BR', 'int', 'return', 'if', 'else', 'for', 'while', 'CRGB']);

export function hash32(a, b) {
  let h = (Math.imul(a, 0x9E3779B1) ^ Math.imul(b + 1, 0x85EBCA6B)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2C1B3C6D) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}
const c01 = (x) => Math.min(1, Math.max(0, x));
const toU32 = (x) => { const f = Math.floor(x); return f < 0 ? 0 : f >>> 0; };
export const FX = {
  fract: (x) => x - Math.floor(x),
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  clamp01: c01,
  mix: (a, b, m) => a + (b - a) * m,
  step: (e, x) => (x < e ? 0 : 1),
  smooth: (a, b, x) => { const k = c01((x - a) / (b - a)); return k * k * (3 - 2 * k); },
  rnd: (a, b) => hash32(toU32(a), toU32(b)) / 4294967296,
  tri: (x) => 1 - Math.abs((x - Math.floor(x)) * 2 - 1),
  hueR: (h) => c01(Math.abs((h - Math.floor(h)) * 6 - 3) - 1),
  hueG: (h) => c01(2 - Math.abs((h - Math.floor(h)) * 6 - 2)),
  hueB: (h) => c01(2 - Math.abs((h - Math.floor(h)) * 6 - 4)),
};

// C++ helpers the sketch needs when any custom step exists
export const CPP_HELPERS = `static inline float fx_fract(float x) { return x - floorf(x); }
static inline float fx_clamp(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float fx_mix(float a, float b, float m) { return a + (b - a) * m; }
static inline float fx_step(float e, float x) { return x < e ? 0.0f : 1.0f; }
static inline float fx_smooth(float a, float b, float x) { float k = clamp01((x - a) / (b - a)); return k * k * (3.0f - 2.0f * k); }
static inline float fx_rnd(float a, float b) { float fa = floorf(a), fb = floorf(b); return hash32(fa < 0 ? 0u : (uint32_t)fa, fb < 0 ? 0u : (uint32_t)fb) / 4294967296.0f; }
static inline float fx_tri(float x) { return 1.0f - fabsf(fx_fract(x) * 2.0f - 1.0f); }
static inline float fx_hueR(float h) { return clamp01(fabsf(fx_fract(h) * 6.0f - 3.0f) - 1.0f); }
static inline float fx_hueG(float h) { return clamp01(2.0f - fabsf(fx_fract(h) * 6.0f - 2.0f)); }
static inline float fx_hueB(float h) { return clamp01(2.0f - fabsf(fx_fract(h) * 6.0f - 4.0f)); }`;

const TOK = /\s+|\/\/[^\n]*|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|[-+*/()?:<>,;=])/y;

function tokenize(src) {
  const out = [];
  TOK.lastIndex = 0;
  while (TOK.lastIndex < src.length) {
    const at = TOK.lastIndex;
    const m = TOK.exec(src);
    if (!m) throw new Error(`Unexpected character "${src[at]}"`);
    if (m[1]) out.push({ k: 'num', s: m[1] });
    else if (m[2]) out.push({ k: 'id', s: m[2] });
    else if (m[3]) out.push({ k: 'op', s: m[3] });
  }
  return out;
}

// Returns { js: Function, cpp: string } or throws a readable Error.
export function compileCustom(src) {
  if (!src || src.length > 4000) throw new Error('Code is empty or too long');
  const toks = tokenize(src);
  const stmts = [[]];
  for (const t of toks) (t.k === 'op' && t.s === ';') ? stmts.push([]) : stmts[stmts.length - 1].push(t);
  const locals = new Set();
  const jsLines = [], cppLines = [];
  let assignedOut = false;
  for (const st of stmts) {
    if (!st.length) continue;
    let k = 0, decl = false;
    if (st[0].k === 'id' && st[0].s === 'float') { decl = true; k = 1; }
    const name = st[k];
    if (!name || name.k !== 'id' || !st[k + 1] || st[k + 1].s !== '=') throw new Error('Each statement must look like  name = expression;');
    if (decl) {
      if (RESERVED.has(name.s) || OUTPUTS.includes(name.s)) throw new Error(`"${name.s}" can't be used as a variable name`);
      if (locals.has(name.s)) throw new Error(`"${name.s}" declared twice`);
    } else if (!OUTPUTS.includes(name.s) && !locals.has(name.s)) {
      throw new Error(`"${name.s}" isn't declared – use  float ${name.s} = ...;`);
    }
    if (OUTPUTS.includes(name.s)) assignedOut = true;
    const expr = st.slice(k + 2);
    if (!expr.length) throw new Error(`Missing expression for ${name.s}`);
    const [js, cpp] = translateExpr(expr, locals);
    if (decl) locals.add(name.s);
    jsLines.push(`${decl ? 'let ' : ''}${name.s} = ${js};`);
    cppLines.push(`${decl ? 'float ' : ''}${name.s} = ${cpp};`);
  }
  if (!assignedOut) throw new Error('Set at least one of r, g, b');
  const body = `let r = 0, g = 0, b = 0;\n${jsLines.join('\n')}\nreturn [r, g, b];`;
  let fn;
  try { fn = new Function('u', 'v', 'o', 't', 'i', 'n', 'side', 'PI', 'FX', body); }
  catch (e) { throw new Error('Syntax error: ' + e.message); }
  const test = fn(0.3, 0.6, 0.7, 1.23, 5, 40, 0, Math.PI, FX);
  if (!test.every(Number.isFinite)) throw new Error('Formula produces invalid numbers (check for divide by zero)');
  return {
    js: (L, t) => fn(L.u, L.v, L.o, t, L.i, L.n, L.side, Math.PI, FX),
    cpp: `float r = 0.0f, g = 0.0f, b = 0.0f;\n  ${cppLines.join('\n  ')}`,
  };
}

function translateExpr(toks, locals) {
  const js = [], cpp = [];
  const stack = [];
  let prev = null;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.k === 'num') {
      js.push(t.s);
      let s = t.s.startsWith('.') ? '0' + t.s : t.s;
      if (!/[.eE]/.test(s)) s += '.0';
      else if (s.endsWith('.')) s += '0';
      cpp.push(s + 'f');
    } else if (t.k === 'id') {
      const next = toks[k + 1];
      if (next && next.s === '(') {
        const f = FUNCS[t.s];
        if (!f) throw new Error(`Unknown function "${t.s}"`);
        js.push(f[0]); cpp.push(f[1]);
        stack.push({ fn: t.s, args: 1, arity: f[2] });
        js.push('('); cpp.push('('); k++;
        if (toks[k + 1] && toks[k + 1].s === ')') throw new Error(`${t.s}() needs ${f[2]} argument(s)`);
      } else if (INPUTS.includes(t.s)) {
        js.push(t.s); cpp.push(t.s === 'PI' ? '3.14159265f' : t.s);
      } else if (locals.has(t.s) || OUTPUTS.includes(t.s)) {
        js.push(t.s); cpp.push(t.s);
      } else throw new Error(`Unknown name "${t.s}"`);
    } else {
      const s = t.s;
      if (s === '=') throw new Error('Use == to compare');
      if (s === '(') stack.push({ fn: null });
      if (s === ',') {
        const top = stack[stack.length - 1];
        if (!top || !top.fn) throw new Error('Unexpected comma');
        top.args++;
      }
      if (s === ')') {
        const top = stack.pop();
        if (!top) throw new Error('Unbalanced )');
        if (top.fn && top.args !== top.arity) throw new Error(`${top.fn}() takes ${top.arity} argument(s)`);
      }
      // wrap comparisons so they become 0/1 numbers in both languages
      js.push(s); cpp.push(s);
    }
    prev = t;
  }
  if (stack.length) throw new Error('Missing )');
  // comparisons: JS booleans behave as 0/1 in arithmetic, C++ bools likewise.
  return [js.join(' '), cpp.join(' ')];
}
