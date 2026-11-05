// Map editor: a rectangle (width × length, feet or meters) plus labeled reference features.
import { api } from '../api.js';
import { card, compassControl, page } from '../components.js';
import { createMapView } from '../map/index.js';
import { FT, fromUnit, toUnit } from '../units.js';
import { h, toast } from '../ui.js';

const QUICK_FEATURES = ['Door', 'Bed', 'Desk', 'Window', 'Closet'];
const newMap = () => ({ name: 'New map', type: 'floorplan', units: 'ft', width: 12 * FT, length: 15 * FT, topBearing: null, features: [] });

export async function mapEditor(root, id) {
  const maps = await api.maps();
  const source = id ? maps.find(m => m.id === id) : maps[0];
  if (id === 'new' || !source) return render(root, newMap(), maps);
  return render(root, structuredClone(source), maps);
}

function render(root, m, maps) {
  const main = page(root, m.id ? 'Edit map' : 'New map');
  const box = h('div', { class: 'map-box' });
  const hint = h('p', { class: 'hint' }, 'Drawn to scale. Add features as reference points for players.');
  let view;

  const round2 = v => +toUnit(v, m.units).toFixed(2);
  const width = h('input', { type: 'number', inputmode: 'decimal', min: 0.5, step: 0.1, value: round2(m.width), required: true });
  const length = h('input', { type: 'number', inputmode: 'decimal', min: 0.5, step: 0.1, value: round2(m.length), required: true });
  const unitLabels = [h('span', { class: 'unit' }), h('span', { class: 'unit' })];
  const unitBtns = ['ft', 'm'].map(u => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(m.units === u), onclick: () => setUnits(u) }, u === 'ft' ? 'Feet' : 'Meters'));
  const name = h('input', { type: 'text', maxlength: 60, value: m.name, oninput: () => (m.name = name.value) });
  const topBearing = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 359, step: 1, placeholder: 'not set', value: m.topBearing ?? '' });
  const featureList = h('ul', { class: 'features-list' });

  function setUnits(u) {
    m.units = u;
    unitBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['ft', 'm'][i] === u)));
    unitLabels.forEach(l => (l.textContent = u));
    width.value = round2(m.width);
    length.value = round2(m.length);
    redraw();
  }
  function readSize() {
    const w = parseFloat(width.value), l = parseFloat(length.value);
    if (w > 0 && l > 0) {
      m.width = fromUnit(w, m.units);
      m.length = fromUnit(l, m.units);
      m.features.forEach(f => { f.pos.x = Math.min(f.pos.x, m.width); f.pos.y = Math.min(f.pos.y, m.length); });
      redraw();
    }
  }
  width.addEventListener('input', readSize);
  length.addEventListener('input', readSize);
  topBearing.addEventListener('input', () => {
    const v = parseFloat(topBearing.value);
    m.topBearing = Number.isFinite(v) ? ((v % 360) + 360) % 360 : null;
    redraw();
  });

  function redraw() {
    view.setMap(m);
    renderFeatures();
  }

  function place(feature) {
    hint.textContent = `Tap the map where “${feature.label || 'feature'}” is.`;
    hint.classList.add('active');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    view.pickPoint(pos => {
      feature.pos = pos;
      hint.textContent = 'Placed. Add another, or save.';
      hint.classList.remove('active');
      redraw();
    });
  }

  function addFeature(label) {
    const f = { id: Math.random().toString(36).slice(2, 10), label, pos: { x: m.width / 2, y: m.length / 2 } };
    m.features.push(f);
    redraw();
    place(f);
    if (!label) featureList.querySelector('li:last-child input')?.focus();
  }

  function renderFeatures() {
    featureList.replaceChildren(...m.features.map(f => {
      const label = h('input', { type: 'text', maxlength: 30, value: f.label, placeholder: 'Label', 'aria-label': 'Feature label' });
      label.addEventListener('input', () => { f.label = label.value; view.setMap(m); });
      return h('li', {},
        label,
        h('button', { type: 'button', class: 'btn small', onclick: () => place(f) }, '📍 Move'),
        h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Remove ${f.label}`, onclick: () => { m.features = m.features.filter(x => x !== f); redraw(); } }, '✕'));
    }));
    if (!m.features.length) featureList.append(h('li', { class: 'muted small' }, 'No features yet.'));
  }

  const compass = compassControl({
    label: '🧭 Measure with phone compass',
    offset: () => 0,
    onHeading: deg => { topBearing.value = deg; m.topBearing = deg; view.setMap(m); },
  });

  async function save() {
    if (!(m.width > 0 && m.length > 0)) return toast('Enter a width and a length', 'error');
    try {
      compass.stop();
      const saved = await api.saveMap({ ...m, name: m.name || 'Untitled map' });
      toast('Map saved');
      history.replaceState(null, '', `#/map/${saved.id}`);
      Object.assign(m, saved);
    } catch (err) { toast(err.message, 'error'); }
  }

  main.append(
    maps.length > 1 || m.id ? h('div', { class: 'row wrap' },
      maps.length > 1 ? h('select', {
        'aria-label': 'Choose map',
        onchange: e => (location.hash = `#/map/${e.target.value}`),
      }, maps.map(x => h('option', { value: x.id, selected: x.id === m.id }, x.name))) : null,
      h('a', { class: 'btn small', href: '#/map/new' }, '+ New map')) : null,
    card(
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'field' }, h('span', {}, 'Units'), h('div', { class: 'segmented' }, unitBtns)),
      h('div', { class: 'row' },
        h('label', { class: 'field grow' }, h('span', {}, 'Width (left ↔ right)'), h('div', { class: 'with-unit' }, width, unitLabels[0])),
        h('label', { class: 'field grow' }, h('span', {}, 'Length (top ↕ bottom)'), h('div', { class: 'with-unit' }, length, unitLabels[1]))),
    ),
    hint,
    box,
    card(
      h('h2', {}, 'Reference features'),
      h('div', { class: 'chips' },
        QUICK_FEATURES.map(l => h('button', { type: 'button', class: 'chip', onclick: () => addFeature(l) }, `+ ${l}`)),
        h('button', { type: 'button', class: 'chip', onclick: () => addFeature('') }, '+ Other')),
      featureList,
    ),
    h('details', { class: 'card' },
      h('summary', {}, 'Compass alignment (optional)'),
      h('p', { class: 'small muted' }, 'Which compass direction does the top edge of the map face? Needed only if you use the phone compass to set headings. Stand inside, point the back camera at the top wall, then lock.'),
      h('label', { class: 'field' }, h('span', {}, 'Top of map faces (°, 0 = north)'), topBearing),
      compass.el),
    h('div', { class: 'sticky-actions' }, h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Save map')),
  );

  view = createMapView(box, m);
  unitLabels.forEach(l => (l.textContent = m.units));
  renderFeatures();
  return () => { compass.stop(); view.destroy(); };
}
