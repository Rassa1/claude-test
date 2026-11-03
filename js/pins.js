// ESP32 (classic ESP32-WROOM / DevKit V1) GPIO catalogue and pin-usage helpers.

// note: shown next to the pin; warn: pin works but has a catch; out: can drive LEDs; pullup: has internal pull-up
export const ESP32_PINS = [
  { pin: 4, out: true, pullup: true },
  { pin: 5, out: true, pullup: true, warn: 'boot strapping pin – fine for LEDs' },
  { pin: 13, out: true, pullup: true },
  { pin: 14, out: true, pullup: true },
  { pin: 16, out: true, pullup: true },
  { pin: 17, out: true, pullup: true },
  { pin: 18, out: true, pullup: true },
  { pin: 19, out: true, pullup: true },
  { pin: 21, out: true, pullup: true },
  { pin: 22, out: true, pullup: true },
  { pin: 23, out: true, pullup: true },
  { pin: 25, out: true, pullup: true },
  { pin: 26, out: true, pullup: true },
  { pin: 27, out: true, pullup: true },
  { pin: 32, out: true, pullup: true },
  { pin: 33, out: true, pullup: true },
  { pin: 2, out: true, pullup: true, warn: 'on-board LED / boot pin' },
  { pin: 12, out: true, pullup: true, warn: 'boot pin – must be LOW at power-up' },
  { pin: 15, out: true, pullup: true, warn: 'boot pin – prints boot log' },
  { pin: 34, out: false, pullup: false, warn: 'input only, needs external 10k pull-up' },
  { pin: 35, out: false, pullup: false, warn: 'input only, needs external 10k pull-up' },
  { pin: 36, out: false, pullup: false, warn: 'input only (VP), needs external 10k pull-up' },
  { pin: 39, out: false, pullup: false, warn: 'input only (VN), needs external 10k pull-up' },
];
export const PIN_INFO = Object.fromEntries(ESP32_PINS.map((p) => [p.pin, p]));

// ESP32 FastLED drives LED lines with the RMT peripheral: 8 channels
export const MAX_LED_OUTPUTS = 8;

// pin -> list of "who uses it" labels
export function pinUsage(matrix, buttons) {
  const use = new Map();
  const add = (pin, who) => { if (!use.has(pin)) use.set(pin, []); use.get(pin).push(who); };
  const lights = matrix.lights || 'both';
  matrix.outputs.forEach((o, k) => {
    if (lights !== 'right') add(o.pinL, `LEDs ${lights === 'both' ? 'L' : ''}${k + 1}`);
    if (lights !== 'left') add(o.pinR, `LEDs ${lights === 'both' ? 'R' : ''}${k + 1}`);
  });
  buttons.forEach((b) => add(b.pin, b.name));
  return use;
}

// <option>s for a pin <select>. `mine` = this control's own label (not a conflict with itself)
export function pinOptions(current, usage, mine, forOutput) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = ESP32_PINS.filter((p) => !forOutput || p.out);
  if (!PIN_INFO[current]) list.unshift({ pin: current, warn: 'not a recommended pin' });
  return list.map((p) => {
    const users = (usage.get(p.pin) || []).filter((u) => u !== mine);
    const tags = [];
    if (users.length) tags.push('used by ' + users.join(', '));
    else if (p.warn) tags.push(p.warn);
    return `<option value="${p.pin}" ${p.pin === current ? 'selected' : ''}>GPIO ${p.pin}${tags.length ? ' · ' + esc(tags.join(' · ')) : ''}</option>`;
  }).join('');
}

// warnings for the whole configuration
export function pinProblems(matrix, buttons) {
  const out = [];
  const use = pinUsage(matrix, buttons);
  for (const [pin, who] of use) if (who.length > 1) out.push(`GPIO ${pin} is used by ${who.join(' and ')}.`);
  const lines = (matrix.lights === 'both' ? 2 : 1) * matrix.outputs.length;
  if (lines > MAX_LED_OUTPUTS) out.push(`${lines} LED data lines: the ESP32 can drive at most ${MAX_LED_OUTPUTS} at once.`);
  buttons.forEach((b) => { if (PIN_INFO[b.pin] && !PIN_INFO[b.pin].pullup) out.push(`${b.name}: GPIO ${b.pin} has no internal pull-up – add a 10k resistor to 3.3V.`); });
  return out;
}
