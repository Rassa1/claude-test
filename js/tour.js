// Guided tours: a short intro that plays on the first visit, and a detailed
// guide for each tab. Each step points at an element; steps whose element is
// missing or hidden are skipped automatically.

const DONE_KEY = 'taillight-intro-done';

export const TOURS = {
  intro: [
    { title: 'Welcome to Taillight Studio', body: 'Design LED taillights, test how they react to the brake, blinkers and running lights, then get ready-to-flash ESP32 code. This 1-minute tour shows the basics. You can skip it any time.' },
    { tab: 'build', target: '.tabs', title: 'Three steps', body: '<b>1 Build</b> the LED layout, <b>2</b> set up the <b>inputs &amp; effects</b> (what the lights do and when), <b>3</b> copy the <b>ESP32 code</b>.' },
    { tab: 'build', target: '#buildCanvas', title: 'Your light', body: 'This is the left taillight seen from behind; the right one is its mirror image. Drag a row sideways to shift it.', place: 'center' },
    { tab: 'build', target: '#rows', title: 'Size it', body: 'Set the rows, LEDs per meter and row length to match your strip. Shape buttons below make staggered, tapered or curved layouts.' },
    { tab: 'animate', target: '#btnbar', title: 'Test like it’s on the car', body: 'These are the wires going into the ESP32. Click to switch one on, hold for a quick press. Try brake and both blinkers together.' },
    { tab: 'animate', target: '#fxList', title: 'Effects', body: 'Each effect is an animation with a trigger, like “Hazards = Left AND Right blinker”. Higher in the list draws on top.' },
    { tab: 'animate', target: '#bPrompt', title: 'Describe it', body: 'Type what you want in plain English and press <b>Generate</b>. Then fine-tune the steps below.' },
    { tab: 'code', target: '#copy', title: 'Get the code', body: 'Copy the sketch into the Arduino IDE and upload it. Power, sleep and test options are on the right.' },
    { tab: 'code', target: '#projBtn', title: 'Projects', body: 'Keep test and official versions, make copies before experimenting, and export them as files.' },
    { target: '#guideBtn', title: 'Need more detail?', body: 'Every page has its own step-by-step guide here. Have fun!' },
  ],

  build: [
    { tab: 'build', target: '#buildCanvas', title: 'The layout view', body: 'Shows the left light from behind. <b>Drag</b> a row sideways to shift it; click a row to highlight it in the list. Coloured lines show how each data line is wired and the <b>OUT</b> dot marks its first LED.', place: 'center' },
    { tab: 'build', target: '#rows', title: 'Rows and density', body: 'Number of rows, LEDs per meter (printed on your strip), the length of each row and the gap between rows. Changing the length or density resets every row’s LED count.' },
    { tab: 'build', target: '#shapes', title: 'Shapes', body: 'Quick layouts: staggered (alternate rows shifted half an LED), taper, slant, arc or a random shift. <b>Shape strength</b> sets how strong the effect is.' },
    { tab: 'build', target: '#rowTable', title: 'Fine-tune each row', body: 'Per row: number of LEDs, sideways shift in mm, and which data line it’s wired to. × removes the row.' },
    { tab: 'build', target: '#board', title: 'Your ESP32 board', body: 'Pick your exact board so every pin menu shows the right pins, using its printed labels (e.g. XIAO <b>D4</b>). Switching boards moves any pin that doesn’t exist.' },
    { tab: 'build', target: '#lights', title: 'One or two lights', body: 'Two mirrored lights (each with its own wires), or a single left or right light, e.g. one ESP32 per side.' },
    { tab: 'build', target: '#outputs', title: 'Data lines', body: 'Big lights need more than one data wire. Each line has its own pin per light; click the row numbers to choose which rows are on it. The fps shows how fast that line can refresh.' },
    { tab: 'build', target: '#splitOut', title: 'Add or split lines', body: '<b>Add data line</b> moves half the rows of the last line onto a new pin. <b>Split rows evenly</b> balances the LED count across lines.' },
    { tab: 'build', target: '#extraDark', title: 'Spare LEDs', body: 'Testing with a strip that’s longer than your layout? Enter how many extra LEDs it has and they’ll stay dark instead of glowing white.' },
    { tab: 'build', target: '#wiring', title: 'Wiring pattern', body: '<b>Zig-zag</b>: each row runs back the other way. <b>Same direction</b>: every row starts on the same side. <b>First LED</b> is the corner where the data wire comes in.' },
    { tab: 'build', target: '#showWiring', title: 'Check the wiring', body: 'Show the data path and LED numbers to compare with your real strip before soldering.' },
  ],

  animate: [
    { tab: 'animate', target: '#simCanvas', title: 'The simulator', body: 'Shows exactly what the ESP32 will do: same animations, same timing, same trigger rules.', place: 'center' },
    { tab: 'animate', target: '#viewSel', title: 'View', body: 'Show both lights or just one.' },
    { tab: 'animate', target: '#btnbar', title: 'Input wires', body: '<b>Click</b> to switch a wire on/off, <b>hold</b> for a momentary press, or use keys <b>1–9</b>. Green = the ESP32 sees it as ON. Blinkers flash like the real relay.' },
    { tab: 'animate', target: '#skip30', title: 'Time & power tools', body: '<b>+30 s</b> jumps the clock (to test “only if off for 30 s” rules and sleep). <b>Power-cycle ESP32</b> acts like cutting its power. The badge on the left shows if it’s awake or asleep.' },
    { tab: 'animate', target: '#inList', title: 'Inputs', body: 'One per wire into the ESP32: pick its pin, whether it’s a wire (on while powered) or a push button (press = on/off), and a <b>hold time</b> so a pulsing blinker reads as one steady ON.' },
    { tab: 'animate', target: '#fxList', title: 'Effects', body: 'Click one to edit it. ↑↓ change priority (top draws over the rest). A green dot means it’s running right now.' },
    { tab: 'animate', target: '#bSide', title: 'Where it shows', body: 'Both lights, or only left/right (turn signals). <b>Replace</b> hides the effects below it; <b>lay lit LEDs on top</b> lets them show through dark LEDs.' },
    { tab: 'animate', target: '#conds', title: 'Trigger condition', body: 'Click an input to cycle <b>ignore → ON → OFF</b>. Example: Left turn = Left blinker ON + Right blinker OFF, so it doesn’t clash with the hazards.' },
    { tab: 'animate', target: '#tKind', title: 'While or once', body: '<b>While</b>: runs as long as the condition is true. <b>Once</b>: plays one time when it turns on. Great for a startup animation, with “only if it was off for N seconds” so it won’t replay while driving.' },
    { tab: 'animate', target: '#bPrompt', title: 'Describe the animation', body: 'Plain English, e.g. “amber sweep outward 3 times” or “scroll the text HELLO across both lights”. On claude.ai, AI reads it and can invent custom effects; elsewhere a keyword reader is used.' },
    { tab: 'animate', target: '#bPreview', title: 'Preview', body: 'Plays this effect now, ignoring its trigger.' },
    { tab: 'animate', target: '#steps', title: 'Steps', body: 'Each effect is a list of steps played in order. Change the type, colours, speed, direction or length. The playing step is outlined.' },
  ],

  code: [
    { tab: 'code', target: '#code', title: 'Your sketch', body: 'Complete Arduino code for your board. The comments at the top list every wire: LED data pins, input pins and how to connect them.', place: 'center' },
    { tab: 'code', target: '#copy', title: 'Copy or download', body: 'Paste it into a new Arduino IDE sketch, pick your board and port, and upload.' },
    { tab: 'code', target: '#ledType', title: 'LED hardware', body: 'Chip type (incl. SK6812 RGBW), colour order (if red shows as green, try another), and a current limit; the code dims everything to stay under it.' },
    { tab: 'code', target: '#pwSleep', title: 'Sleep', body: 'On a permanent 12V feed the ESP32 should sleep when nothing is on. <b>Light sleep</b> wakes instantly (best for brakes); <b>deep sleep</b> uses less power but takes ~0.3 s to wake.' },
    { tab: 'code', target: '#pwWake', title: 'Wake inputs', body: 'Which wires wake it up. Deep sleep can only wake on certain pins; you’ll get a warning if one can’t.' },
    { tab: 'code', target: '#pwLed', title: 'LED power switch', body: 'Strips use ~1 mA per LED even when dark. Let the ESP32 switch their power with a relay, MOSFET or the buck converter’s EN pin, on the 5V (+) side.' },
    { tab: 'code', target: '#debugSerial', title: 'Serial Monitor', body: 'Prints which inputs and effects are on (115200 baud). On XIAO/S3/C3 boards set Tools → USB CDC On Boot → Enabled.' },
    { tab: 'code', target: '#benchForce', title: 'Bench test', body: 'Force inputs ON without wiring anything, handy on the desk. Turn it off before fitting it to the car.' },
    { tab: 'code', target: '#pinTable', title: 'Pin summary', body: 'Every pin in use and what it does. Conflicts and other problems show in orange below.' },
  ],
};

// ---------------------------------------------------------------- engine
let ui = null, steps = [], idx = 0, onTab = null, raf = 0;

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return el.offsetParent !== null && r.width > 0 && r.height > 0;
}

function build() {
  ui = document.createElement('div');
  ui.className = 'tour';
  ui.innerHTML = `<div class="tour-spot"></div>
    <div class="tour-card" role="dialog" aria-live="polite">
      <div class="tour-count"></div><h3 class="tour-title"></h3><div class="tour-body"></div>
      <div class="tour-btns"><button class="ghost sm tour-skip">Skip</button><span></span>
        <button class="ghost sm tour-back">Back</button><button class="primary sm tour-next">Next</button></div>
    </div>`;
  document.body.appendChild(ui);
  ui.querySelector('.tour-skip').onclick = end;
  ui.querySelector('.tour-back').onclick = () => go(idx - 1, -1);
  ui.querySelector('.tour-next').onclick = () => go(idx + 1, 1);
}

function place() {
  if (!ui) return;
  const st = steps[idx], spot = ui.querySelector('.tour-spot'), card = ui.querySelector('.tour-card');
  const el = st.target ? document.querySelector(st.target) : null;
  const vw = innerWidth, vh = innerHeight, pad = 6;
  if (el && visible(el)) {
    const r = el.getBoundingClientRect();
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
    Object.assign(spot.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 12;
    let cx, cy;
    if (st.place === 'center' || vw < 640) { cx = (vw - cw) / 2; cy = vw < 640 ? vh - ch - 16 : Math.min(Math.max(y + 24, 16), vh - ch - 16); }
    else if (r.bottom + gap + ch < vh) { cx = r.left; cy = r.bottom + gap; }
    else if (r.top - gap - ch > 0) { cx = r.left; cy = r.top - gap - ch; }
    else if (r.left - gap - cw > 0) { cx = r.left - gap - cw; cy = r.top; }
    else { cx = r.right + gap; cy = r.top; }
    card.style.left = Math.max(16, Math.min(vw - cw - 16, cx)) + 'px';
    card.style.top = Math.max(16, Math.min(vh - ch - 16, cy)) + 'px';
  } else {
    Object.assign(spot.style, { display: 'block', left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
    card.style.left = Math.max(16, (vw - card.offsetWidth) / 2) + 'px';
    card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + 'px';
  }
}

function loop() { place(); raf = requestAnimationFrame(loop); }

function go(n, dir = 1) {
  if (n < 0) return;
  if (n >= steps.length) { end(); return; }
  idx = n;
  const st = steps[idx];
  if (st.tab && onTab) onTab(st.tab);
  const el = st.target ? document.querySelector(st.target) : null;
  if (st.target && !visible(el)) {               // hidden in this setup: skip it
    if (n + dir >= 0 && n + dir < steps.length) return go(n + dir, dir);
    if (dir > 0) { end(); return; }
  }
  if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  ui.querySelector('.tour-count').textContent = `${idx + 1} / ${steps.length}`;
  ui.querySelector('.tour-title').textContent = st.title;
  ui.querySelector('.tour-body').innerHTML = st.body;
  ui.querySelector('.tour-back').hidden = idx === 0;
  ui.querySelector('.tour-next').textContent = idx === steps.length - 1 ? 'Done' : 'Next';
  ui.querySelector('.tour-next').focus({ preventScroll: true });
}

function onKey(e) {
  if (!ui) return;
  if (e.key === 'Escape') end();
  else if (e.key === 'ArrowRight') go(idx + 1, 1);
  else if (e.key === 'ArrowLeft') go(idx - 1, -1);
}

export function startTour(name, showTab) {
  end();
  steps = TOURS[name] || [];
  if (!steps.length) return;
  onTab = showTab;
  build();
  addEventListener('keydown', onKey, true);
  go(0);
  loop();
  if (name === 'intro') { try { localStorage.setItem(DONE_KEY, '1'); } catch {} }
}

export function end() {
  cancelAnimationFrame(raf);
  removeEventListener('keydown', onKey, true);
  ui?.remove();
  ui = null;
}

export function introSeen() {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}
