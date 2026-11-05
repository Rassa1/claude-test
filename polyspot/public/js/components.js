// Reusable pieces of UI shared by several views.
import { norm360 } from '/shared/geo.js';
import scoring from '/shared/scoring.config.js';
import { maxScore } from '/shared/scoring.js';
import { api } from './api.js';
import { startCompass } from './compass.js';
import { h, points } from './ui.js';

/** Standard page: top bar with a back link and a title. Returns the <main> to fill. */
export function page(root, title, { back = '#/' } = {}) {
  const main = h('main', { class: 'page' });
  root.append(
    h('header', { class: 'topbar' },
      back ? h('a', { class: 'back', href: back, 'aria-label': 'Back' }, '‹') : h('span', { class: 'logo', 'aria-hidden': 'true' }, '◎'),
      h('h1', {}, title)),
    main,
  );
  return main;
}

export const card = (...children) => h('section', { class: 'card' }, ...children);

export function difficultyBadge(key) {
  const d = scoring.difficulties[key];
  return h('span', { class: `badge diff-${key}` }, d ? d.label : key);
}

/** Heading slider with ±5° nudge buttons. onInput(deg) fires as the user changes it. */
export function headingControl({ value = 0, onInput }) {
  let cur = Math.round(value);
  const range = h('input', { type: 'range', min: 0, max: 359, step: 1, value: cur, 'aria-label': 'Facing direction in degrees' });
  const out = h('output', { class: 'heading-val' });
  const arrow = h('span', { class: 'heading-arrow', 'aria-hidden': 'true' }, '↑');
  const show = () => {
    range.value = cur;
    out.textContent = `${cur}°`;
    arrow.style.transform = `rotate(${cur}deg)`;
  };
  const set = v => { cur = Math.round(norm360(v)) % 360; show(); };
  const change = v => { set(v); onInput?.(cur); };
  range.addEventListener('input', () => change(+range.value));
  show();
  const el = h('div', { class: 'heading-ctl' },
    h('button', { type: 'button', class: 'nudge', 'aria-label': 'Rotate left 5 degrees', onclick: () => change(cur - 5) }, '⟲'),
    range,
    h('button', { type: 'button', class: 'nudge', 'aria-label': 'Rotate right 5 degrees', onclick: () => change(cur + 5) }, '⟳'),
    h('span', { class: 'heading-read' }, arrow, out));
  return { el, set };
}

/** Easy / Hard / Nighttime / Impossible chips. */
export function difficultyPicker({ value, onChange }) {
  const el = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Difficulty' });
  const render = () => {
    el.replaceChildren(...Object.entries(scoring.difficulties).map(([key, d]) =>
      h('button', {
        type: 'button', class: `chip diff-${key}`, role: 'radio', 'aria-checked': String(key === value),
        onclick: () => { value = key; render(); onChange?.(key); },
      }, d.label, scoring.useDifficultyMultiplier && d.multiplier !== 1 ? h('small', {}, `×${d.multiplier}`) : null)));
  };
  render();
  return { el, get: () => value };
}

export const maxPointsText = difficulty => `max ${points(maxScore(difficulty))} pts`;

/**
 * "Use phone compass" button. While live, onHeading(deg) fires as the phone turns; tap again to lock.
 * offset() returns the compass bearing of the map's top edge (subtracted from readings).
 */
export function compassControl({ label = '🧭 Use phone compass', offset = () => 0, onHeading, onStop }) {
  let stop = null;
  const btn = h('button', { type: 'button', class: 'btn' }, label);
  const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const end = () => { stop?.(); stop = null; btn.textContent = label; btn.classList.remove('live'); };

  btn.addEventListener('click', () => {
    if (stop) { end(); status.textContent = 'Heading locked. Fine-tune it with the slider if needed.'; onStop?.(); return; }
    status.textContent = 'Starting compass…';
    startCompass(deg => {
      const mapDeg = Math.round(norm360(deg - (offset() || 0)));
      status.textContent = `Compass ${deg}° → map ${mapDeg}°. Hold the phone the way you took the photo, then tap Lock.`;
      onHeading(mapDeg, deg);
    }).then(s => {
      stop = s;
      btn.textContent = '🔒 Lock heading';
      btn.classList.add('live');
    }).catch(async err => {
      status.replaceChildren(err.message);
      if (!window.isSecureContext) {
        const info = await api.info().catch(() => null);
        const httpsUrl = info?.urls?.https?.find(u => u.includes(location.hostname)) || info?.urls?.https?.[0];
        status.append(' ', httpsUrl
          ? h('a', { href: httpsUrl + location.pathname + location.hash }, 'Open the HTTPS version')
          : 'Run `npm run cert` on the laptop and restart (see README).',
        ' You can always set the direction by hand.');
      }
    });
  });
  return { el: h('div', { class: 'compass' }, btn, status), stop: end };
}

/** Big "show this on your phone" box with QR code. */
export function qrBox(url) {
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': `QR code for ${url}` });
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { box.remove(); }
  return box;
}
