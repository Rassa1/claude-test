// Project types: each sets sensible defaults (layout, inputs, effects, power)
// and the wording used across the app, the guides, the AI and the code comments.
//
// inputs:  { key, name, pin, type: 'level'|'toggle', holdMs, simPulse }
// effects: { name, side, layer, repeat, prompt, trigger: { kind, conds: { inputKey: 'on'|'off' }, minOffMs, cancel } }

const sweep = 'amber sequential sweep outward, 3 times';

export const PROFILES = {
  taillight: {
    name: 'Car taillights',
    blurb: 'Two mirrored lights driven by the running, brake and blinker wires.',
    projectName: 'My taillights',
    vehicle: true,
    matrix: {},
    inputs: [
      { key: 'run', name: 'Running lights', pin: 25 },
      { key: 'brake', name: 'Brake', pin: 26 },
      { key: 'L', name: 'Left blinker', pin: 14, holdMs: 800, simPulse: true },
      { key: 'R', name: 'Right blinker', pin: 27, holdMs: 800, simPulse: true },
    ],
    effects: [
      { name: 'Hazards', layer: 'overlay', prompt: sweep, trigger: { conds: { L: 'on', R: 'on' } } },
      { name: 'Left turn', side: 'left', layer: 'overlay', prompt: sweep, trigger: { conds: { L: 'on', R: 'off' } } },
      { name: 'Right turn', side: 'right', layer: 'overlay', prompt: sweep, trigger: { conds: { R: 'on', L: 'off' } } },
      { name: 'Brake', repeat: false, prompt: 'brake: flash red 4 times fast', trigger: { conds: { brake: 'on' } } },
      { name: 'Startup', repeat: false, prompt: 'red sweep from the center out once then red breathe for 2 seconds', trigger: { kind: 'once', minOffMs: 30000, cancel: true, conds: { run: 'on' } } },
      { name: 'Running', prompt: 'dim red tail light', trigger: { conds: { run: 'on' } } },
    ],
    words: {
      title: 'LED Taillights',
      welcome: 'Design LED taillights, test how they react to the brake, blinkers and running lights, then get ready-to-flash ESP32 code.',
      stageHint: 'This is the left taillight seen from behind. The right one is its mirror image. Drag a row sideways to shift it.',
      testTitle: 'Test it like it’s on the car',
      testBody: 'These are the wires going into the ESP32. Click to switch one on, hold for a quick press. Try brake and both blinkers together.',
      ai: 'a car LED taillight',
      conventions: 'Unless the user asks for other colours, respect car conventions (red tail/brake, amber turn signals).',
    },
  },

  bike: {
    name: 'Bike / scooter light',
    blurb: 'One rear light with brake and turn signals, running on a battery.',
    projectName: 'My bike light',
    vehicle: true,
    matrix: { lights: 'left', rows: 3, rowLengthCm: 20, power: { sleep: 'light', sleepAfterS: 30 } },
    inputs: [
      { key: 'run', name: 'Power on', pin: 25 },
      { key: 'brake', name: 'Brake', pin: 26 },
      { key: 'L', name: 'Left signal', pin: 14, holdMs: 800, simPulse: true },
      { key: 'R', name: 'Right signal', pin: 27, holdMs: 800, simPulse: true },
    ],
    effects: [
      { name: 'Hazards', layer: 'overlay', prompt: 'amber blink every 700ms', trigger: { conds: { L: 'on', R: 'on' } } },
      { name: 'Left turn', layer: 'overlay', prompt: 'amber sequential sweep right to left, 3 times', trigger: { conds: { L: 'on', R: 'off' } } },
      { name: 'Right turn', layer: 'overlay', prompt: 'amber sequential sweep left to right, 3 times', trigger: { conds: { R: 'on', L: 'off' } } },
      { name: 'Brake', repeat: false, prompt: 'brake: flash red 4 times fast', trigger: { conds: { brake: 'on' } } },
      { name: 'Startup', repeat: false, prompt: 'red sweep from the center out once', trigger: { kind: 'once', minOffMs: 30000, cancel: true, conds: { run: 'on' } } },
      { name: 'Running', prompt: 'dim red tail light', trigger: { conds: { run: 'on' } } },
    ],
    words: {
      title: 'LED Bike Light',
      welcome: 'Design a bike or scooter light, test how it reacts to the brake and turn signals, then get ready-to-flash ESP32 code.',
      stageHint: 'Your light, seen from behind. Drag a row sideways to shift it.',
      testTitle: 'Test it like it’s on the bike',
      testBody: 'These are the wires going into the ESP32. Click to switch one on, hold for a quick press. Try braking while signalling.',
      ai: 'a bicycle / scooter LED rear light (one light)',
      conventions: 'Unless the user asks for other colours, use red for rear/brake light and amber for turn signals.',
    },
  },

  matrix: {
    name: 'LED matrix / sign',
    blurb: 'A grid panel for scrolling text, pixel animations and signs.',
    projectName: 'My LED matrix',
    matrix: { lights: 'left', rows: 8, ledsPerMeter: 100, rowLengthCm: 32, rowGapMm: 10 },
    inputs: [{ key: 'mode', name: 'Mode button', pin: 13, type: 'toggle' }],
    effects: [
      { name: 'Rainbow mode', prompt: 'rainbow wave for 5 seconds', trigger: { conds: { mode: 'on' } } },
      { name: 'Message', prompt: 'scroll the text "HELLO"', trigger: { kind: 'always' } },
    ],
    words: {
      title: 'LED Matrix',
      welcome: 'Design an LED matrix or sign, preview animations and scrolling text, then get ready-to-flash ESP32 code.',
      stageHint: 'Your LED matrix, front view. Each row is a line of LEDs; drag one sideways to shift it.',
      testTitle: 'Try the inputs',
      testBody: 'These are the buttons and switches wired to the ESP32. Click to switch one on, hold for a quick press.',
      ai: 'an LED matrix / sign panel',
      conventions: '',
    },
  },

  strip: {
    name: 'LED strip / room lighting',
    blurb: 'A long single strip for desks, shelves, TVs and ambient light.',
    projectName: 'My LED strip',
    matrix: { lights: 'left', rows: 1, rowLengthCm: 100 },
    inputs: [{ key: 'mode', name: 'Mode button', pin: 13, type: 'toggle' }],
    effects: [
      { name: 'Party mode', prompt: 'rainbow wave fast', trigger: { conds: { mode: 'on' } } },
      { name: 'Warm glow', prompt: 'warm white breathe slowly 60%', trigger: { kind: 'always' } },
    ],
    words: {
      title: 'LED Strip',
      welcome: 'Design an LED strip for your room, desk or shelves, preview the effects, then get ready-to-flash ESP32 code.',
      stageHint: 'Your LED strip. A single row is a straight strip; add rows for strips running side by side.',
      testTitle: 'Try the inputs',
      testBody: 'These are the buttons and switches wired to the ESP32. Click to switch one on, hold for a quick press.',
      ai: 'an LED strip used for room / ambient lighting',
      conventions: '',
    },
  },

  wearable: {
    name: 'Costume / wearable',
    blurb: 'Small battery-powered pieces for cosplay, props and outfits.',
    projectName: 'My costume lights',
    matrix: { lights: 'left', rows: 5, rowLengthCm: 17, maxMilliamps: 1000 },
    inputs: [{ key: 'mode', name: 'Button', pin: 13, type: 'toggle' }],
    effects: [
      { name: 'Chase mode', prompt: 'cyan chase with 4 dots, fast', trigger: { conds: { mode: 'on' } } },
      { name: 'Sparkle', prompt: 'white sparkle on blue', trigger: { kind: 'always' } },
    ],
    words: {
      title: 'LED Wearable',
      welcome: 'Design lights for a costume, prop or outfit, preview the effects, then get ready-to-flash ESP32 code.',
      stageHint: 'Your piece, front view. Drag a row sideways to shift it.',
      testTitle: 'Try the inputs',
      testBody: 'These are the buttons wired to the ESP32. Click to switch one on, hold for a quick press.',
      ai: 'LEDs on a costume / wearable prop',
      conventions: 'Keep brightness modest (battery powered, close to people’s eyes) unless asked otherwise.',
    },
  },

  blank: {
    name: 'Something else',
    blurb: 'Start from a simple grid with one button and one effect.',
    projectName: 'My LED project',
    matrix: { lights: 'left' },
    inputs: [{ key: 'btn', name: 'Button', pin: 13, type: 'toggle' }],
    effects: [{ name: 'Effect 1', prompt: 'red breathe', trigger: { conds: { btn: 'on' } } }],
    words: {
      title: 'LED Project',
      welcome: 'Design an LED layout, preview animations, then get ready-to-flash ESP32 code.',
      stageHint: 'Your LED layout. Drag a row sideways to shift it.',
      testTitle: 'Try the inputs',
      testBody: 'These are the buttons and switches wired to the ESP32. Click to switch one on, hold for a quick press.',
      ai: 'an LED light project',
      conventions: '',
    },
  },
};

export const profileOf = (id) => PROFILES[id] || PROFILES.taillight;
