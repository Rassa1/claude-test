// AI interpretation of an animation description, using Claude through the
// claude.ai artifact runtime when available. Falls back to the keyword parser.
import { ANIMS, DIRS, defaultParams, defaultDuration, compiled } from './animations.js';
import { FUNCS } from './custom.js';
import { parseDescription } from './parser.js';

let samplePromise = null;
export function getSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try { return window.claude?.use ? await window.claude.use('sample') : null; } catch { return null; }
    })();
  }
  return samplePromise;
}

function animCatalog() {
  return Object.entries(ANIMS).filter(([id]) => id !== 'custom').map(([id, a]) => `- ${id}: ${a.desc} Params: ${a.uses.join(', ') || 'none'}`).join('\n');
}

function buildPrompt(text, ctx) {
  return `You convert a plain-English description of a car LED taillight animation into JSON for a simulator that also generates ESP32 code.

LIGHT: ${ctx.leds} LEDs per light in ${ctx.rows} rows (about ${ctx.widthCm} cm wide, ${ctx.heightCm} cm tall). There are two taillights (left and right, mirror images). This animation belongs to a button called "${ctx.name}" that drives: ${ctx.side} light(s). It ${ctx.repeat ? 'loops while active' : 'plays once and holds its last frame'}.

Return ONLY a JSON object:
{"summary": "one short sentence describing what you made", "repeat": true|false, "steps": [STEP, ...]}

Steps play in order. Each STEP: {"type": <type>, "duration": seconds, "brightness": 0..1, ...params}
Preset types:
${animCatalog()}
- custom: anything the presets can't do. Param "code" (string) in the formula language below.

Params:
- color, color2: [r,g,b] 0-255 (car red [255,0,0], amber [255,110,0], dim tail red = red at brightness 0.3-0.4)
- period: seconds per cycle (speed)
- dir: one of ${Object.keys(DIRS).join(', ')} ("outer" = from the inner edge toward the car's outside edge, the normal turn-signal direction)
- width: 0.02-1, count: integer 1-20, flashes: integer 1-10, trail: 0-0.5 background glow

Formula language for "custom" (compiles to both JavaScript and C++, so follow it exactly):
- Statements separated by ";". Declare locals with "float name = expr;". Assign outputs r, g, b (0..1, default 0).
- Inputs: u (0 left .. 1 right as seen from behind), v (0 top .. 1 bottom), o (0 inner edge .. 1 outer edge), t (seconds since the step started), i (LED index in wiring order), n (LED count), side (0 left light, 1 right light), PI.
- Functions: ${Object.entries(FUNCS).map(([k, f]) => `${k}(${f[2]} arg${f[2] > 1 ? 's' : ''})`).join(', ')}.
  fract = fractional part, tri(x) = triangle wave 0..1..0 with period 1, step(edge,x) = x<edge?0:1, smooth(a,b,x) = smoothstep, rnd(a,b) = repeatable random 0..1 from two numbers (e.g. rnd(i, floor(t*15))), hueR/G/B(h) = rainbow channel for hue h 0..1.
- Operators: + - * / ( ) < > <= >= == != and the ternary a ? b : c. No &&, ||, !, %, if, loops or other functions.
Example custom code: "float head = fract(t / 1.2); float d = abs(o - head); r = clamp01(1 - d * 8); g = r * 0.15;"

Prefer presets when they fit; use custom for anything else. Keep total length sensible (1-15 s). Unless the user asks for other colours, respect car conventions (red tail/brake, amber turn signals).

DESCRIPTION: ${text}`;
}

const isRGB = (c) => Array.isArray(c) && c.length === 3 && c.every((x) => Number.isFinite(+x));
const num = (x, lo, hi, d) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : d);

export function sanitizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, 20)) {
    if (!r || !ANIMS[r.type]) continue;
    const s = { type: r.type, ...defaultParams(r.type) };
    if (isRGB(r.color)) s.color = r.color.map((x) => num(x, 0, 255, 0) | 0);
    if (isRGB(r.color2)) s.color2 = r.color2.map((x) => num(x, 0, 255, 0) | 0);
    s.period = num(r.period, 0.05, 20, s.period);
    if (DIRS[r.dir]) s.dir = r.dir;
    s.width = num(r.width, 0.02, 1, s.width);
    s.count = Math.round(num(r.count, 1, 20, s.count));
    s.flashes = Math.round(num(r.flashes, 1, 10, s.flashes));
    s.trail = num(r.trail, 0, 0.5, s.trail);
    s.brightness = num(r.brightness, 0.02, 1, s.brightness);
    if (r.type === 'custom') {
      if (typeof r.code !== 'string' || !compiled(r.code)) continue;
      s.code = r.code;
    }
    s.duration = num(r.duration, 0.05, 60, defaultDuration(s));
    out.push(s);
  }
  return out;
}

export async function interpret(text, ctx, signal) {
  const sample = await getSample();
  if (sample) {
    try {
      const res = await sample.json(buildPrompt(text, ctx), { signal });
      const steps = sanitizeSteps(res?.steps);
      if (steps.length) {
        return { steps, repeat: typeof res.repeat === 'boolean' ? res.repeat : null, summary: String(res.summary || ''), via: 'ai' };
      }
      return { ...fallback(text), note: 'AI reply was unusable, used the built-in parser.' };
    } catch (e) {
      if (e?.code === 'cancelled') throw e;
      const why = {
        not_granted: 'AI not allowed for this page',
        sampling_disabled: 'AI not available on this account',
        rate_limited: 'AI is busy – try again in a bit',
      }[e?.code] || 'AI failed';
      return { ...fallback(text), note: why + ', used the built-in parser.' };
    }
  }
  return { ...fallback(text), note: 'AI only works on the claude.ai-hosted page; used the built-in parser.' };
}

function fallback(text) {
  return { steps: parseDescription(text), repeat: null, summary: '', via: 'parser' };
}
