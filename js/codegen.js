// Generates a complete Arduino sketch for ESP32 + FastLED that reproduces the
// simulator exactly: same animation math, same button/layer rules.
import { ANIMS, DIRS, fmtF } from './animations.js';
import { CPP_HELPERS } from './custom.js';
import { currentBoard, pinName } from './pins.js';
import { SIDE_MASK, condMasks, totalMs, stepMs, lightCols } from './engine.js';

const wrap = (arr, per = 20, indent = '  ') => {
  const lines = [];
  for (let k = 0; k < arr.length; k += per) lines.push(indent + arr.slice(k, k + per).join(', '));
  return lines.join(',\n');
};
const cstr = (s) => String(s).replace(/[^\x20-\x7e]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const cmt = (s) => String(s).replace(/→/g, '->').replace(/[·–—]/g, '-').replace(/[^\x20-\x7e]/g, ' ').replace(/\\/g, '/').replace(/\*\//g, '* /').replace(/\/\*/g, '/ *');

function describe(s) {
  const d = ANIMS[s.type] || ANIMS.off;
  const bits = [d.name];
  if (d.uses.includes('dir')) bits.push(DIRS[s.dir]);
  if (d.uses.includes('color')) bits.push(`rgb(${s.color.join(',')})`);
  bits.push(`${s.duration}s`);
  return bits.join(' · ');
}

export function generateSketch(matrix, layout, model) {
  const { inputs, effects } = model;
  const n = layout.leds.length;
  const U = layout.leds.map((l) => l.qu);
  const V = layout.leds.map((l) => l.qv);
  const lights = matrix.lights || 'both';
  const sideIds = lights === 'both' ? [0, 1] : lights === 'right' ? [1] : [0];
  const outs = matrix.outputs.map((o, k) => ({ ...o, ...layout.outInfo[k], k })).filter((o) => o.count > 0);
  const pinOf = (o, side) => (side ? o.pinR : o.pinL);
  const rowList = (rows) => rows.map((r) => r + 1).join(', ');
  const rowsDesc = matrix.rows.map((r, i) => ` *   row ${i + 1}: ${r.count} LEDs, shifted ${(+r.offset).toFixed(1)} mm`).join('\n');
  const rgbw = /RGBW/.test(matrix.ledType);
  const chipType = rgbw ? matrix.ledType.replace(/_?RGBW$/, '') : matrix.ledType;
  const board = currentBoard();
  const forceIds = new Set(matrix.benchForce || []);
  const forceMask = inputs.reduce((m, x, k) => (forceIds.has(x.id) ? m | (1 << k) : m), 0) >>> 0;
  const debug = matrix.debugSerial !== false;
  const extra = Math.max(0, Math.min(1000, matrix.extraDark | 0));
  const tctx = { nr: matrix.rows.length, wc: lightCols(layout), pair: lights === 'both' };
  const usesCustom = effects.some((b) => b.steps.some((s) => s.type === 'custom'));
  const inName = (id) => inputs.find((x) => x.id === id)?.name || '?';
  const condText = (fx) => {
    const parts = Object.entries(fx.trigger.conds).filter(([id, c]) => c !== 'ignore' && inputs.some((x) => x.id === id)).map(([id, c]) => `${inName(id)} ${c.toUpperCase()}`);
    return parts.length ? parts.join(fx.trigger.match === 'any' ? ' OR ' : ' AND ') : '(never – no inputs selected)';
  };
  const trigText = (fx) => fx.trigger.kind === 'once'
    ? `once when [${condText(fx)}] turns on${fx.trigger.minOffMs ? ` after being off for ${fx.trigger.minOffMs / 1000} s+` : ''}${fx.trigger.cancel ? ', stops early if it turns off' : ''}`
    : `while [${condText(fx)}]`;
  const inDocs = inputs.map((x, k) => ` *   ${k}. ${cmt(x.name)} – ${pinName(x.pin)}, ${x.type === 'toggle' ? 'push button (press = on/off)' : `on while signal present${x.holdMs ? `, held ${x.holdMs} ms after it drops` : ''}`}`).join('\n');

  const btnDocs = effects.map((b, k) =>
    ` *   ${k + 1}. ${cmt(b.name)} – ${cmt(trigText(b))}, ${b.side} light${b.side === 'both' ? 's' : ''}, ${b.layer === 'overlay' ? 'layered on top' : 'replaces lower layers'}\n` +
    b.steps.map((s, j) => ` *        ${j + 1}) ${cmt(describe(s))}`).join('\n')).join('\n');

  const stepFns = effects.map((b, bk) => b.steps.map((s, k) => {
    const def = ANIMS[s.type] || ANIMS.off;
    return `// ${cmt(b.name)} – step ${k + 1}: ${cmt(describe(s))}
static CRGB b${bk}s${k}(int i_, float u, float v, float o, int side_, float t) {
  float i = (float)i_; float side = (float)side_; float n = (float)NUM_LEDS;
  (void)i; (void)side; (void)n; (void)u; (void)v; (void)o; (void)t;
  const float kBright = ${(+s.brightness).toFixed(3)}f; (void)kBright;
  ${def.cpp(s, tctx).replace(/\(uint32_t\)i\b/g, '(uint32_t)i_')}
}`;
  }).join('\n\n')).join('\n\n');

  const stepArrays = effects.map((b, bk) =>
    `static const uint32_t B${bk}_MS[] = { ${b.steps.length ? b.steps.map(stepMs).join(', ') : '1'} };`).join('\n');
  const inTable = inputs.map((x) => `  { ${x.pin}, ${x.type === 'toggle'}, ${x.type === 'toggle' ? 0 : (x.holdMs | 0)} },  // ${cmt(x.name)}`).join('\n');
  const btnTable = effects.map((b, bk) => {
    const m = condMasks(b, inputs);
    return `  { ${b.trigger.kind === 'once' ? 1 : 0}, 0x${m.needOn.toString(16)}u, 0x${m.needOff.toString(16)}u, ${b.trigger.match !== 'any'}, ${b.trigger.kind === 'once' ? (b.trigger.minOffMs | 0) : 0}u, ${!!b.trigger.cancel}, ${SIDE_MASK[b.side] || 3}, ${b.layer === 'overlay'}, ${b.trigger.kind === 'while' && !!b.repeat}, ${b.steps.length}, B${bk}_MS, ${totalMs(b) || 1} },  // ${cmt(b.name)}`;
  }).join('\n');
  const dispatch = effects.map((b, bk) =>
    `    case ${bk}: switch (step) {\n${b.steps.map((_, k) => `      case ${k}: return b${bk}s${k}(i, u, v, o, side, t);`).join('\n')}\n    } break;`).join('\n');

  return `/*
 * LED Taillights – generated by Taillight Studio
 * ------------------------------------------------
 * Board:   ${board.name}
 * Arduino: Tools > Board > ${board.chip === 'ESP32' ? 'ESP32 Dev Module' : board.name.startsWith('Seeed') ? board.name.replace('Seeed ', '').replace(/ /g, '_').replace('-', '') : board.chip.replace('-', '') + ' Dev Module'}
 * Library: FastLED${rgbw ? ' 3.9 or newer (needed for RGBW)' : ''}  (Arduino IDE: Tools > Manage Libraries > search "FastLED")
 *
 * LED wiring:
${sideIds.map((s) => outs.map((o) => ` *   ${s ? 'Right' : 'Left'} light, data line ${o.k + 1} (row${o.rows.length > 1 ? 's' : ''} ${rowList(o.rows)}, ${o.count} LEDs) DIN -> ${pinName(pinOf(o, s))}`).join('\n')).join('\n')}
 *   Put a 330 ohm resistor in each data line; a 74AHCT125 level shifter (4 lines each) is recommended.
 *   Each data line starts at the ${matrix.start.replace('-', ' ')} corner of its own rows${matrix.wiring === 'serpentine' ? ' and zig-zags through them' : ', every row running the same direction'}
 *   (on the right light everything is mirrored).
 *   LED 5V -> 5V supply (NOT the ESP32 3V3 pin), LED GND -> supply GND + ESP32 GND.
 *   In a car use a 12V -> 5V buck converter rated for the current below.
 *
 * Inputs (a signal pulls its GPIO to GND = ON; internal pull-ups used):
${inDocs}
 *   For 12V car wires (running / brake / blinkers) use an optocoupler (e.g. PC817) per input:
 *   12V wire -> 1k resistor -> opto LED -> GND; opto transistor between GPIO and GND.
 *   Blinker wires pulse on/off: give them a hold time (~800 ms) so they read as one continuous ON.
 *   Power the ESP32 from a feed that stays on (ignition or permanent 12V via a buck converter) so
 *   "once" effects can tell how long the lights were off. If it's powered from the running-light wire,
 *   it restarts every time the lights come on and every "once" effect replays.
 *
 * Light: ${n} LEDs per light, ${matrix.rows.length} rows, ${matrix.ledsPerMeter} LEDs/m, ${matrix.wiring} wiring from the ${matrix.start}.
 *   The right light is a mirror image of the left one (wire it the same way, mirrored).
${rowsDesc}
 *
 * Effects (top = highest priority, drawn over the ones below it):
${btnDocs}
 */

#include <FastLED.h>
#include <math.h>

#define NUM_LEDS        ${n}           // per light
#define LED_TYPE        ${chipType}${rgbw ? '        // RGBW strip: white channel driven via setRgbw() below' : ''}
#define COLOR_ORDER     ${matrix.colorOrder}
#define MAX_MILLIAMPS   ${matrix.maxMilliamps}        // FastLED dims everything to stay under this
#define FRAME_MS        10          // ~100 fps
#ifndef DEBOUNCE_MS
#define DEBOUNCE_MS     25
#endif
#define LIGHT_COLS      ${fmtF(lightCols(layout))}    // light width in LED spacings (text effect)
#define NUM_SIDES       ${sideIds.length}
#define NUM_INPUTS      ${Math.max(1, inputs.length)}
#define NUM_EFFECTS     ${Math.max(1, effects.length)}
#define DEBUG_SERIAL    ${debug ? 1 : 0}           // 1 = print inputs/effects to the Serial Monitor (115200 baud)
// BENCH TEST: inputs forced ON without any wiring (bit k = input k). Set to 0 for the car!
#define BENCH_FORCE_ON  0x${forceMask.toString(16)}u${forceMask ? `   // forced: ${inputs.filter((x) => forceIds.has(x.id)).map((x) => cmt(x.name)).join(', ')}` : ''}

static const uint8_t SIDE_ID[NUM_SIDES] = { ${sideIds.join(', ')} };   // 0 = left, 1 = right
// Each data line is followed by EXTRA_DARK spare LEDs that are always sent black
// (so a strip longer than the layout stays dark instead of showing random colours)
#define EXTRA_DARK      ${extra}
#define NUM_LINES       ${outs.length}
static const uint16_t LINE_START[NUM_LINES] = { ${outs.map((o) => o.start).join(', ')} };
#define BUF_LEDS        (NUM_LEDS + NUM_LINES * EXTRA_DARK)
CRGB leds[NUM_SIDES][BUF_LEDS];

static inline int bufIndex(int i) {        // layout LED index -> position in the leds[] buffer
  int ln = 0;
  while (ln < NUM_LINES - 1 && i >= LINE_START[ln + 1]) ln++;
  return i + ln * EXTRA_DARK;
}

// Normalised LED positions (0..255) of the LEFT light in wiring order: U = left->right, V = top->bottom
// Data lines split this array: ${outs.map((o) => `line ${o.k + 1} = LEDs ${o.start}..${o.start + o.count - 1}`).join(', ')}
const uint8_t LED_U[NUM_LEDS] = {
${wrap(U)}
};
const uint8_t LED_V[NUM_LEDS] = {
${wrap(V)}
};

static const float TWO_PI_F = 6.28318530718f;
static inline float clamp01(float x) { return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x); }
static inline float fractf(float x) { return x - floorf(x); }
static inline CRGB shade(uint8_t r, uint8_t g, uint8_t b, float k) {
  k = clamp01(k);
  return CRGB((uint8_t)(r * k + 0.5f), (uint8_t)(g * k + 0.5f), (uint8_t)(b * k + 0.5f));
}
static inline CRGB mix2(uint8_t r1, uint8_t g1, uint8_t b1, uint8_t r2, uint8_t g2, uint8_t b2, float m, float k) {
  k = clamp01(k);
  float r = (r1 + (r2 - r1) * m) * k, g = (g1 + (g2 - g1) * m) * k, b = (b1 + (b2 - b1) * m) * k;
  return CRGB((uint8_t)(clamp01(r / 255.0f) * 255.0f + 0.5f), (uint8_t)(clamp01(g / 255.0f) * 255.0f + 0.5f), (uint8_t)(clamp01(b / 255.0f) * 255.0f + 0.5f));
}
static inline CRGB hueColor(float h, float k) {
  float r = clamp01(fabsf(h * 6.0f - 3.0f) - 1.0f);
  float g = clamp01(2.0f - fabsf(h * 6.0f - 2.0f));
  float b = clamp01(2.0f - fabsf(h * 6.0f - 4.0f));
  return shade((uint8_t)(r * 255.0f + 0.5f), (uint8_t)(g * 255.0f + 0.5f), (uint8_t)(b * 255.0f + 0.5f), k);
}
static inline uint32_t hash32(uint32_t a, uint32_t b) {
  uint32_t h = (a * 0x9E3779B1u) ^ ((b + 1u) * 0x85EBCA6Bu);
  h ^= h >> 15;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12;
  return h;
}
${usesCustom ? '\n' + CPP_HELPERS + '\n' : ''}
// ---------------------------------------------------------------- animations
${stepFns}

// ---------------------------------------------------------------- inputs
struct Input {
  uint8_t pin;
  bool toggle;          // true: push button, each press flips on/off
  uint16_t holdMs;      // level inputs: stay ON this long after the signal drops
};
static const Input INPUT_CFG[NUM_INPUTS] = {
${inTable}
};
bool rawSig[NUM_INPUTS], stableSig[NUM_INPUTS], prevSig[NUM_INPUTS], inOn[NUM_INPUTS], inEverOn[NUM_INPUTS];
uint32_t lastFlip[NUM_INPUTS], inLastOn[NUM_INPUTS];

static void debounceInputs(uint32_t now) {        // runs every loop()
  for (int k = 0; k < NUM_INPUTS; k++) {
    bool sig = digitalRead(INPUT_CFG[k].pin) == LOW;
    if (sig != rawSig[k]) { rawSig[k] = sig; lastFlip[k] = now; }
    if (sig != stableSig[k] && now - lastFlip[k] >= DEBOUNCE_MS) stableSig[k] = sig;
  }
}

static uint32_t updateInputs(uint32_t now) {      // runs every frame, returns bit mask of ON inputs
  uint32_t mask = 0;
  for (int k = 0; k < NUM_INPUTS; k++) {
    bool raw = stableSig[k] || (BENCH_FORCE_ON & (1u << k));
    if (INPUT_CFG[k].toggle) {
      if (raw && !prevSig[k]) inOn[k] = !inOn[k];
    } else {
      if (raw) { inLastOn[k] = now; inEverOn[k] = true; }
      inOn[k] = raw || (inEverOn[k] && now - inLastOn[k] < INPUT_CFG[k].holdMs);
    }
    prevSig[k] = raw;
    if (inOn[k]) mask |= 1u << k;
  }
  return mask;
}

// ---------------------------------------------------------------- effects
struct Effect {
  uint8_t kind;         // 0 = while condition is true, 1 = once when it turns on
  uint32_t needOn;      // inputs that must be ON  (bit k = input k)
  uint32_t needOff;     // inputs that must be OFF
  bool matchAll;        // true: every listed input must match. false: any one is enough
  uint32_t minOffMs;    // once: only if the condition was off at least this long (or never on)
  bool cancel;          // once: stop early if the condition turns off
  uint8_t sides;        // bit 0 = left light, bit 1 = right light
  bool overlay;         // true: only lit pixels cover lower layers
  bool repeat;          // while: loop the steps (false = play once, hold last frame)
  uint8_t numSteps;
  const uint32_t* stepMs;
  uint32_t totalMs;
};
${stepArrays}
static const Effect EFFECT_CFG[NUM_EFFECTS] = {
${btnTable}
};
bool fxPrev[NUM_EFFECTS], fxActive[NUM_EFFECTS], fxEverOn[NUM_EFFECTS];
uint32_t fxSince[NUM_EFFECTS], fxOffSince[NUM_EFFECTS];

static bool evalCond(int k, uint32_t on) {   // takes an index: Arduino's auto-prototypes can't see struct types
  const Effect& e = EFFECT_CFG[k];
  if (!e.needOn && !e.needOff) return false;
  if (!e.matchAll) return (on & e.needOn) || (~on & e.needOff);
  return (on & e.needOn) == e.needOn && (on & e.needOff) == 0;
}

static void updateEffects(uint32_t on, uint32_t now) {
  for (int k = 0; k < NUM_EFFECTS; k++) {
    const Effect& e = EFFECT_CFG[k];
    bool cond = evalCond(k, on);
    if (e.kind == 1) {
      if (cond && !fxPrev[k]) {
        if (!fxEverOn[k] || now - fxOffSince[k] >= e.minOffMs) { fxActive[k] = true; fxSince[k] = now; }
        fxEverOn[k] = true;
      }
      if (!cond && fxPrev[k]) fxOffSince[k] = now;
      if (fxActive[k] && e.cancel && !cond) fxActive[k] = false;
      if (fxActive[k] && now - fxSince[k] >= e.totalMs) fxActive[k] = false;
    } else {
      if (cond && !fxPrev[k]) fxSince[k] = now;
      fxActive[k] = cond;
    }
    fxPrev[k] = cond;
  }
}

static CRGB renderPixel(int fx, int step, int i, float u, float v, float o, int side, float t) {
  switch (fx) {
${dispatch}
  }
  return CRGB::Black;
}

// ---------------------------------------------------------------- serial debug
static const char* const INPUT_NAMES[NUM_INPUTS] = { ${inputs.map((x) => `"${cstr(x.name)}"`).join(', ') || '""'} };
static const char* const EFFECT_NAMES[NUM_EFFECTS] = { ${effects.map((x) => `"${cstr(x.name)}"`).join(', ') || '""'} };

static void debugPrint(uint32_t now, uint32_t inMask) {
#if DEBUG_SERIAL
  static uint32_t lastIn = 0xffffffffu, lastFx = 0xffffffffu, lastPrint = 0;
  uint32_t fxMask = 0;
  for (int k = 0; k < NUM_EFFECTS; k++) if (fxActive[k]) fxMask |= 1u << k;
  bool changed = inMask != lastIn || fxMask != lastFx;
  if (!changed && now - lastPrint < 10000) return;          // otherwise a status line every 10 s
  lastIn = inMask; lastFx = fxMask; lastPrint = now;
  Serial.printf("[%7.1fs] inputs:", now / 1000.0f);
  for (int k = 0; k < NUM_INPUTS; k++) {
    Serial.printf(" %s=%s%s", INPUT_NAMES[k], (inMask >> k) & 1 ? "ON" : "off", (BENCH_FORCE_ON >> k) & 1 ? "(forced)" : "");
  }
  Serial.print("  | effects:");
  bool any = false;
  for (int k = 0; k < NUM_EFFECTS; k++) if ((fxMask >> k) & 1) { Serial.printf(" %s", EFFECT_NAMES[k]); any = true; }
  Serial.println(any ? "" : " (none - LEDs off)");
#else
  (void)now; (void)inMask;
#endif
}

void setup() {
#if DEBUG_SERIAL
  Serial.begin(115200);   // XIAO / S3 / C3: Tools > USB CDC On Boot must be "Enabled" to see this
#endif
${sideIds.map((s, k) => outs.map((o, j) => `  FastLED.addLeds<LED_TYPE, ${pinOf(o, s)}, COLOR_ORDER>(leds[${k}] + ${o.start + j * extra}, ${o.count + extra})${rgbw ? '.setRgbw(RgbwDefault())' : ''};   // ${s ? 'right' : 'left'} light, line ${o.k + 1}: row${o.rows.length > 1 ? 's' : ''} ${rowList(o.rows)}`).join('\n')).join('\n')}
  FastLED.setMaxPowerInVoltsAndMilliamps(5, MAX_MILLIAMPS);
  FastLED.setBrightness(255);
  FastLED.clear(true);
#if DEBUG_SERIAL
  delay(1500);            // give the Serial Monitor a moment to connect
  Serial.println();
  Serial.println("Taillight Studio sketch running");
  Serial.printf("  %d LEDs per light, %d light(s), %d inputs, %d effects\\n", NUM_LEDS, NUM_SIDES, NUM_INPUTS, NUM_EFFECTS);
  for (int k = 0; k < NUM_INPUTS; k++) Serial.printf("  input %d: %s on GPIO %d%s\\n", k, INPUT_NAMES[k], INPUT_CFG[k].pin, (BENCH_FORCE_ON >> k) & 1 ? "  (BENCH TEST: forced ON)" : "");
  Serial.println("  An input is ON when its pin is connected to GND.");
#endif
  for (int k = 0; k < NUM_INPUTS; k++) pinMode(INPUT_CFG[k].pin, INPUT_PULLUP);
}

void loop() {
  static uint32_t lastFrame = 0;
  uint32_t now = millis();
  debounceInputs(now);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;

  uint32_t inMask = updateInputs(now);
  updateEffects(inMask, now);
  debugPrint(now, inMask);

  // work out which step each active effect is on
  bool act[NUM_EFFECTS];
  int curStep[NUM_EFFECTS];
  float curT[NUM_EFFECTS];
  for (int b = 0; b < NUM_EFFECTS; b++) {
    act[b] = fxActive[b] && EFFECT_CFG[b].numSteps > 0;
    if (!act[b]) continue;
    uint32_t el = now - fxSince[b];
    uint32_t cyc = EFFECT_CFG[b].repeat ? el % EFFECT_CFG[b].totalMs : (el < EFFECT_CFG[b].totalMs - 1 ? el : EFFECT_CFG[b].totalMs - 1);
    int k = 0; uint32_t start = 0;
    while (k < EFFECT_CFG[b].numSteps - 1 && cyc >= start + EFFECT_CFG[b].stepMs[k]) { start += EFFECT_CFG[b].stepMs[k]; k++; }
    curStep[b] = k;
    curT[b] = (cyc - start) / 1000.0f;
  }

  for (int s = 0; s < NUM_SIDES; s++) {
    int side = SIDE_ID[s];
    for (int i = 0; i < NUM_LEDS; i++) {
      uint8_t qu = side ? 255 - LED_U[i] : LED_U[i];
      float u = qu / 255.0f, v = LED_V[i] / 255.0f, o = (255 - LED_U[i]) / 255.0f;
      CRGB c = CRGB::Black;
      for (int b = NUM_EFFECTS - 1; b >= 0; b--) {      // lowest priority first
        if (!act[b] || !(EFFECT_CFG[b].sides & (1 << side))) continue;
        CRGB x = renderPixel(b, curStep[b], i, u, v, o, side, curT[b]);
        if (!EFFECT_CFG[b].overlay || x.r || x.g || x.b) c = x;
      }
      leds[s][bufIndex(i)] = c;
    }
  }
  FastLED.show();
}
`;
}
