// ESP32 board catalogue: which GPIOs each board exposes, their silkscreen
// labels, and catches. Plus pin-usage / conflict helpers.
//
// pin: GPIO number · label: silkscreen name (XIAO "D0" …) · out: can drive LEDs
// pullup: has an internal pull-up (inputs) · warn: works, but has a catch

const classic = [
  { pin: 4 }, { pin: 5, warn: 'boot strapping pin – fine for LEDs' }, { pin: 13 }, { pin: 14 }, { pin: 16 }, { pin: 17 },
  { pin: 18 }, { pin: 19 }, { pin: 21 }, { pin: 22 }, { pin: 23 }, { pin: 25 }, { pin: 26 }, { pin: 27 }, { pin: 32 }, { pin: 33 },
  { pin: 2, warn: 'on-board LED / boot pin' }, { pin: 12, warn: 'boot pin – must be LOW at power-up' }, { pin: 15, warn: 'boot pin – prints boot log' },
  { pin: 34, out: false, pullup: false, warn: 'input only, needs external 10k pull-up' },
  { pin: 35, out: false, pullup: false, warn: 'input only, needs external 10k pull-up' },
  { pin: 36, out: false, pullup: false, warn: 'input only (VP), needs external 10k pull-up' },
  { pin: 39, out: false, pullup: false, warn: 'input only (VN), needs external 10k pull-up' },
];

const xiaoS3 = [
  { pin: 1, label: 'D0' }, { pin: 2, label: 'D1' }, { pin: 3, label: 'D2', warn: 'strapping pin – avoid pulling it during power-up' },
  { pin: 4, label: 'D3' }, { pin: 5, label: 'D4' }, { pin: 6, label: 'D5' }, { pin: 43, label: 'D6', warn: 'TX pin' },
  { pin: 44, label: 'D7', warn: 'RX pin' }, { pin: 7, label: 'D8' }, { pin: 8, label: 'D9' }, { pin: 9, label: 'D10' },
];

const s3Devkit = [
  ...[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47].map((pin) => ({ pin })),
  { pin: 3, warn: 'strapping pin' }, { pin: 0, warn: 'BOOT button / strapping pin' },
  { pin: 45, warn: 'strapping pin' }, { pin: 46, warn: 'strapping pin' }, { pin: 48, warn: 'RGB LED on many DevKits' },
  { pin: 19, warn: 'USB D-' }, { pin: 20, warn: 'USB D+' }, { pin: 43, warn: 'TX pin' }, { pin: 44, warn: 'RX pin' },
  { pin: 35, warn: 'used by PSRAM on N8R8/N16R8 modules' }, { pin: 36, warn: 'used by PSRAM on N8R8/N16R8 modules' }, { pin: 37, warn: 'used by PSRAM on N8R8/N16R8 modules' },
];

const c3 = [
  ...[0, 1, 3, 4, 5, 6, 7, 10].map((pin) => ({ pin })),
  { pin: 2, warn: 'strapping pin' }, { pin: 8, warn: 'strapping pin / on-board LED' }, { pin: 9, warn: 'BOOT button / strapping pin' },
  { pin: 20, warn: 'RX pin' }, { pin: 21, warn: 'TX pin' }, { pin: 18, warn: 'USB D-' }, { pin: 19, warn: 'USB D+' },
];

const xiaoC3 = [
  { pin: 2, label: 'D0', warn: 'strapping pin' }, { pin: 3, label: 'D1' }, { pin: 4, label: 'D2' }, { pin: 5, label: 'D3' },
  { pin: 6, label: 'D4' }, { pin: 7, label: 'D5' }, { pin: 21, label: 'D6', warn: 'TX pin' }, { pin: 20, label: 'D7', warn: 'RX pin' },
  { pin: 8, label: 'D8', warn: 'strapping pin' }, { pin: 9, label: 'D9', warn: 'BOOT button / strapping pin' }, { pin: 10, label: 'D10' },
];

// parallel: how many LED data lines the chip's RMT hardware sends at the same time
export const BOARDS = {
  esp32: { name: 'ESP32 (DevKit V1 / WROOM)', chip: 'ESP32', parallel: 8, pins: classic, defaultsLed: [5, 18, 16, 17], defaultsIn: [25, 26, 14, 27, 13, 33, 32, 4] },
  xiao_s3: { name: 'Seeed XIAO ESP32-S3', chip: 'ESP32-S3', parallel: 4, pins: xiaoS3, defaultsLed: [1, 2, 7, 8], defaultsIn: [4, 5, 6, 9, 43, 44, 3] },
  s3_devkit: { name: 'ESP32-S3 DevKit', chip: 'ESP32-S3', parallel: 4, pins: s3Devkit, defaultsLed: [4, 5, 6, 7], defaultsIn: [15, 16, 17, 18, 8, 9, 10, 11] },
  c3: { name: 'ESP32-C3 DevKit', chip: 'ESP32-C3', parallel: 2, pins: c3, defaultsLed: [4, 5, 6, 7], defaultsIn: [0, 1, 3, 10, 6, 7] },
  xiao_c3: { name: 'Seeed XIAO ESP32-C3', chip: 'ESP32-C3', parallel: 2, pins: xiaoC3, defaultsLed: [3, 4, 5, 6], defaultsIn: [7, 10, 21, 20, 2] },
};

let board = BOARDS.esp32;
let INFO = {};
export function setBoard(id) {
  board = BOARDS[id] || BOARDS.esp32;
  INFO = Object.fromEntries(board.pins.map((p) => [p.pin, { out: true, pullup: true, ...p }]));
}
setBoard('esp32');
export const currentBoard = () => board;
export const pinInfo = (pin) => INFO[pin];
export const pinName = (pin) => (INFO[pin]?.label ? `${INFO[pin].label} (GPIO ${pin})` : `GPIO ${pin}`);

// pin -> list of "who uses it" labels
export function pinUsage(matrix, inputs) {
  const use = new Map();
  const add = (pin, who) => { if (!use.has(pin)) use.set(pin, []); use.get(pin).push(who); };
  const lights = matrix.lights || 'both';
  matrix.outputs.forEach((o, k) => {
    if (lights !== 'right') add(o.pinL, `LEDs ${lights === 'both' ? 'L' : ''}${k + 1}`);
    if (lights !== 'left') add(o.pinR, `LEDs ${lights === 'both' ? 'R' : ''}${k + 1}`);
  });
  inputs.forEach((b) => add(b.pin, b.name));
  return use;
}

// first free pin on this board, preferring its suggested order
export function freePin(usage, kind = 'in', exclude = []) {
  const used = new Set([...usage.keys(), ...exclude]);
  const prefer = kind === 'led' ? board.defaultsLed : board.defaultsIn;
  const order = [...prefer, ...board.pins.filter((p) => !p.warn && p.out !== false).map((p) => p.pin), ...board.pins.map((p) => p.pin)];
  return order.find((p) => !used.has(p) && (kind !== 'led' || INFO[p]?.out)) ?? board.pins[0].pin;
}

// After switching boards: move every pin the new board doesn't have to a free one
export function remapPins(matrix, inputs) {
  const fix = (pin, kind, taken) => (INFO[pin] && (kind !== 'led' || INFO[pin].out) && !taken.has(pin) ? pin : freePin(new Map([...taken].map((p) => [p, []])), kind));
  const taken = new Set();
  const lights = matrix.lights || 'both';
  for (const o of matrix.outputs) {
    if (lights !== 'right') { o.pinL = fix(o.pinL, 'led', taken); taken.add(o.pinL); }
    if (lights !== 'left') { o.pinR = fix(o.pinR, 'led', taken); taken.add(o.pinR); }
  }
  for (const x of inputs) { x.pin = fix(x.pin, 'in', taken); taken.add(x.pin); }
}

// <option>s for a pin <select>. `mine` = this control's own label (not a conflict with itself)
export function pinOptions(current, usage, mine, forOutput) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = board.pins.map((p) => ({ out: true, pullup: true, ...p })).filter((p) => !forOutput || p.out);
  if (!INFO[current]) list.unshift({ pin: current, warn: `not on the ${board.name}` });
  return list.map((p) => {
    const users = (usage.get(p.pin) || []).filter((u) => u !== mine);
    const tags = [];
    if (users.length) tags.push('used by ' + users.join(', '));
    else if (p.warn) tags.push(p.warn);
    const name = p.label ? `${p.label} · GPIO ${p.pin}` : `GPIO ${p.pin}`;
    return `<option value="${p.pin}" ${p.pin === current ? 'selected' : ''}>${name}${tags.length ? ' · ' + esc(tags.join(' · ')) : ''}</option>`;
  }).join('');
}

// warnings for the whole configuration
export function pinProblems(matrix, inputs) {
  const out = [];
  const use = pinUsage(matrix, inputs);
  for (const [pin, who] of use) {
    if (who.length > 1) out.push(`${pinName(pin)} is used by ${who.join(' and ')}.`);
    if (!INFO[pin]) out.push(`GPIO ${pin} (${who.join(', ')}) isn't a pin on the ${board.name}.`);
  }
  const lines = (matrix.lights === 'both' ? 2 : 1) * matrix.outputs.length;
  if (lines > board.parallel) out.push(`${lines} LED data lines: the ${board.chip} sends ${board.parallel} at once, the rest go out in turns (works, but lowers the frame rate).`);
  inputs.forEach((b) => { if (INFO[b.pin] && !INFO[b.pin].pullup) out.push(`${b.name}: GPIO ${b.pin} has no internal pull-up – add a 10k resistor to 3.3V.`); });
  return out;
}
