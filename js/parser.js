// Turns a plain-English description into a list of animation steps.
// e.g. "amber sweep from the center out, fast, 3 times then brake flash red 4 times then dim red for 3 seconds"
import { ANIMS, defaultParams, defaultDuration } from './animations.js';

const COLORS = {
  red: [255, 0, 0], 'dark red': [120, 0, 0], amber: [255, 110, 0], orange: [255, 80, 0],
  yellow: [255, 190, 0], white: [255, 255, 255], 'warm white': [255, 180, 110],
  blue: [0, 60, 255], 'ice blue': [120, 200, 255], cyan: [0, 220, 255], green: [0, 255, 40],
  purple: [150, 0, 255], violet: [150, 0, 255], pink: [255, 30, 140], magenta: [255, 0, 200],
  teal: [0, 200, 140], lime: [140, 255, 0],
};

const TYPE_WORDS = [
  ['text', /\b(text|message|words?|says?|saying|spell\w*|scrolling text)\b|"[^"]+"|“[^”]+”/],
  ['off', /\b(off|pause|wait|nothing|blackout|lights out)\b/],
  ['rainbow', /\b(rainbow|unicorn|pride|rgb cycle)\b/],
  ['sparkle', /\b(sparkl\w*|twinkl\w*|glitter\w*|random)\b/],
  ['scanner', /\b(knight ?rider|kitt|scanner|scan\w*|larson|cylon|bounc\w*|back and forth|ping ?pong)\b/],
  ['sequential', /\b(sequential|sweep\w*|swip\w*|turn signal|turn|indicator|blinker|audi|dynamic|wip\w*|fill\w*|startup|welcome)\b/],
  ['brake', /\b(brake|braking|stop light|stop)\b/],
  ['chase', /\b(chas\w*|running dots?|marquee|theat\w*|dots?|comet)\b/],
  ['wave', /\b(wave|gradient|flow\w*|ripple)\b/],
  ['breathe', /\b(breath\w*|puls\w*|fad\w*|glow\w*|throb\w*)\b/],
  ['blink', /\b(blink\w*|hazard\w*|flash\w*|strob\w*|flicker\w*)\b/],
  ['solid', /\b(solid|steady|static|on|tail ?light|running light|drl|constant)\b/],
];

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, once: 1, twice: 2 };
const num = (s) => (s in NUM_WORDS ? NUM_WORDS[s] : parseFloat(s));
const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)';

function findColors(txt) {
  const found = [];
  const names = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  let rest = txt;
  for (const n of names) {
    const re = new RegExp(`\\b${n}\\b`, 'g');
    let m;
    while ((m = re.exec(rest))) {
      found.push({ at: m.index, c: COLORS[n] });
      rest = rest.slice(0, m.index) + ' '.repeat(n.length) + rest.slice(m.index + n.length);
    }
  }
  const hex = /#([0-9a-f]{6})\b/g;
  let m;
  while ((m = hex.exec(txt))) {
    const v = parseInt(m[1], 16);
    found.push({ at: m.index, c: [(v >> 16) & 255, (v >> 8) & 255, v & 255] });
  }
  return found.sort((a, b) => a.at - b.at).map((x) => x.c);
}

function parseStep(raw) {
  const txt = ' ' + raw.toLowerCase().trim() + ' ';
  let type = 'solid';
  for (const [t, re] of TYPE_WORDS) if (re.test(txt)) { type = t; break; }
  // "flash N times" on a red/brake-ish description = brake
  if (type === 'blink' && /\b(red)\b/.test(txt) && /\b(then stay|and stay|stay on|hold)\b/.test(txt)) type = 'brake';

  const s = { type, ...defaultParams(type) };
  const notes = [];
  if (type === 'text') {
    const q = raw.match(/["“']([^"”']+)["”']/) || raw.match(/\b(?:says?|saying|text|message|spell(?:s|ing)?)\s*:?\s+(.+?)(?:\s+in\s+\w+|\s+on\s+|\s+across|\s+for\s+\d|,|$)/i);
    if (q) s.text = q[1].trim().slice(0, 64);
    if (/\beach\b|both lights separately|on each/.test(txt)) s.span = 'each';
    if (/\bsmall\b|tiny/.test(txt)) s.font = 'small';
    if (/\b(big|large)\b/.test(txt)) s.font = 'large';
    if (/left to right|rightward|to the right/.test(txt)) s.scroll = 'right';
  }

  const cols = findColors(txt);
  if (type === 'sparkle') {
    // "white sparkle on red": first color = twinkles, second = base
    if (cols[0]) s.color2 = cols[0];
    if (cols[1]) s.color = cols[1];
  } else {
    if (cols[0]) s.color = cols[0];
    if (cols[1]) s.color2 = cols[1];
  }
  if (!cols[0]) {
    if (/\b(turn|indicator|blinker|hazard)/.test(txt)) s.color = [255, 110, 0];
    if (/\b(brake|stop|tail)/.test(txt)) s.color = [255, 0, 0];
  }

  // direction
  if (/(inner|inside)\s*(edge\s*)?(to|->)\s*(the\s*)?(outer|outside)|towards? the outside|outward/.test(txt)) s.dir = 'outer';
  else if (/(outer|outside)\s*(edge\s*)?(to|->)\s*(the\s*)?(inner|inside)|towards? the inside|inward/.test(txt)) s.dir = 'inner';
  else if (/(center|centre|middle)\s*(to|->)?\s*(the\s*)?(out|edges?|sides?)|from the (center|centre|middle)/.test(txt)) s.dir = 'out';
  else if (/(edges?|sides?|outside)\s*(to|->)?\s*(the\s*)?(in|center|centre|middle)|to the (center|centre|middle)/.test(txt)) s.dir = 'in';
  else if (/right\s*(to|->)\s*left|to the left|leftward/.test(txt) && !/left\s*(to|->)\s*right|from the left/.test(txt)) s.dir = 'rtl';
  else if (/left\s*(to|->)\s*right|to the right|rightward|from the left/.test(txt)) s.dir = 'ltr';
  else if (/bottom\s*(to|->)\s*top|\bupward|\bup\b|bottom up/.test(txt)) s.dir = 'up';
  else if (/top\s*(to|->)\s*bottom|\bdownward|\bdown\b|top down/.test(txt)) s.dir = 'down';

  if (type === 'text') {
    if (/\b(fast|quick)\b/.test(txt)) s.speed = 14;
    if (/\bslow(ly)?\b/.test(txt)) s.speed = 5;
  }
  // speed words
  if (/\b(super|very|really|extra) (fast|quick)\b|\bstrob/.test(txt)) s.period *= 0.35;
  else if (/\b(fast|quick|rapid)\b/.test(txt)) s.period *= 0.55;
  else if (/\b(very|really|super) slow\b/.test(txt)) s.period *= 3;
  else if (/\bslow(ly)?\b/.test(txt)) s.period *= 1.8;

  // explicit durations: "for 5 seconds" = step length; other times = cycle speed
  let duration = null;
  const durRe = new RegExp(`\\bfor\\s+${NUM}\\s*(ms|milliseconds?|s|secs?|seconds?)\\b`);
  const dm = txt.match(durRe);
  let rest = txt;
  if (dm) {
    duration = num(dm[1]) / (/^m/.test(dm[2]) ? 1000 : 1);
    rest = txt.replace(dm[0], ' ');
  }
  const perRe = new RegExp(`${NUM}\\s*(ms|milliseconds?|s|secs?|seconds?)\\b`);
  const pm = rest.match(perRe);
  if (pm) s.period = num(pm[1]) / (/^m/.test(pm[2]) ? 1000 : 1);

  // counts
  const timesRe = new RegExp(`${NUM}\\s*(times|flashes|blinks|x\\b)`);
  const tm = txt.match(timesRe) || txt.match(/\b(once|twice)\b/);
  let times = tm ? num(tm[1]) : null;
  const dotsRe = new RegExp(`${NUM}\\s*(dots|bars|stripes|waves|comets|bands)`);
  const cm = txt.match(dotsRe);
  if (cm) s.count = Math.round(num(cm[1]));
  if (type === 'brake' && times) s.flashes = Math.round(times);

  // brightness
  const bm = txt.match(/(\d{1,3})\s*%/);
  if (bm) s.brightness = Math.min(1, num(bm[1]) / 100);
  else if (/\bon (a )?(dim|faint)\b/.test(txt)) s.trail = Math.min(s.trail || 0.15, 0.15);
  else if (/\b(dim|low|soft|faint)\b/.test(txt)) s.brightness = 0.3;
  else if (/\b(bright|full|max)\b/.test(txt)) s.brightness = 1;

  // width
  if (/\b(wide|big|long|thick)\b/.test(txt)) s.width = Math.min(1, s.width * 2);
  if (/\b(thin|narrow|small|short|tight)\b/.test(txt)) s.width = Math.max(0.03, s.width * 0.5);
  if (type === 'sparkle' && /\b(lots|dense|many|heavy)\b/.test(txt)) s.width = 0.5;

  s.period = +s.period.toFixed(3);
  if (duration) s.duration = duration;
  else if (times && type !== 'brake') s.duration = +(s.period * times).toFixed(3);
  else s.duration = defaultDuration(s);

  notes.push(`${ANIMS[type].name}`);
  return s;
}

export function parseDescription(text) {
  const parts = text
    .split(/\bthen\b|\bafter that\b|\bfollowed by\b|;|->|→|\n/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map(parseStep);
}

export const EXAMPLES = [
  'amber sequential sweep from the center out, 3 times then off for 0.3 seconds',
  'brake: flash red 4 times fast then solid red for 2 seconds',
  'dim red tail light',
  'red knight rider scanner, slow',
  'left turn signal amber sweep 4 times',
  'red breathe for 4 seconds then red sweep bottom to top then solid red 40% for 3 seconds',
  'red chase with 4 dots on dark red, fast',
  'red and amber wave for 6 seconds',
  'rainbow wave for 5 seconds then white sparkle on dim red for 4 seconds',
  'hazard: amber blink every 700ms',
  'scroll the text "HELLO" across both lights',
];
