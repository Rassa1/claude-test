// Host mode: photo → true position + heading → difficulty → release date → save.
import scoring from '/shared/scoring.config.js';
import { api } from '../api.js';
import { card, compassControl, difficultyPicker, headingControl, maxPointsText, page } from '../components.js';
import { createMapView } from '../map/index.js';
import { fileToJpeg } from '../photo.js';
import { h, toast, today, formatDate } from '../ui.js';

export async function host(root) {
  const maps = await api.maps();
  const main = page(root, 'Host a round');
  if (!maps.length) {
    main.append(card(h('p', {}, 'Make a map first.'), h('a', { class: 'btn primary', href: '#/map/new' }, 'Create a map')));
    return;
  }

  let lastMap = null;
  try { lastMap = localStorage.getItem('polyspot.hostMap'); } catch {}
  const state = { photo: null, map: maps.find(m => m.id === lastMap) || maps[0], pos: null, heading: 0, difficulty: scoring.defaultDifficulty, date: today(), title: '' };
  let view, editor;

  // 1. photo
  const preview = h('img', { class: 'preview', alt: 'Selected photo', hidden: true });
  const onFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.photo = await fileToJpeg(file);
      preview.src = state.photo;
      preview.hidden = false;
    } catch (err) { toast(err.message, 'error'); }
  };
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: onFile });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onFile });

  // 2. truth on map
  const box = h('div', { class: 'map-box' });
  const hint = h('p', { class: 'hint' });
  const heading = headingControl({ value: 0, onInput: deg => { state.heading = deg; editor.set({ heading: deg }); } });
  const compass = compassControl({
    offset: () => state.map.topBearing ?? 0,
    onHeading: deg => { state.heading = deg; heading.set(deg); editor.set({ heading: deg }); },
  });
  const compassNote = h('p', { class: 'small muted' });
  const mapSelect = maps.length > 1
    ? h('select', { 'aria-label': 'Map', onchange: e => useMap(maps.find(m => m.id === e.target.value)) },
      maps.map(m => h('option', { value: m.id, selected: m.id === state.map.id }, m.name)))
    : null;

  function useMap(map) {
    state.map = map;
    state.pos = null;
    try { localStorage.setItem('polyspot.hostMap', map.id); } catch {}
    view?.destroy();
    view = createMapView(box, map);
    hint.textContent = view.hints.place;
    editor = view.editPose({
      value: { pos: null, heading: state.heading }, color: 'var(--truth)', label: 'Camera',
      onChange: v => {
        state.pos = v.pos;
        state.heading = v.heading;
        heading.set(v.heading);
        hint.textContent = view.hints.adjust;
      },
    });
    compassNote.textContent = map.type === 'latlng'
      ? 'North is up on this map, so compass readings are used as they are.'
      : map.topBearing == null
      ? 'Compass assumes the top of the map faces north. Set the real direction in Edit map → Compass alignment.'
      : `Top of this map faces ${Math.round(map.topBearing)}°.`;
  }

  // 3–4. difficulty, date, title
  const maxText = h('p', { class: 'small muted' }, maxPointsText(state.difficulty));
  const difficulty = difficultyPicker({ value: state.difficulty, onChange: d => { state.difficulty = d; maxText.textContent = maxPointsText(d); } });
  const date = h('input', { type: 'date', value: state.date, required: true, oninput: e => (state.date = e.target.value) });
  const title = h('input', { type: 'text', maxlength: 80, placeholder: 'e.g. Desk corner', oninput: e => (state.title = e.target.value) });

  const saveBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Save round');
  saveBtn.addEventListener('click', async () => {
    if (!state.photo) return toast('Add a photo first', 'error');
    if (!state.pos) return toast('Tap the map to set where the photo was taken', 'error');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      compass.stop();
      const round = await api.createRound({
        mapId: state.map.id, photo: state.photo, truth: { pos: state.pos, heading: state.heading },
        difficulty: state.difficulty, date: state.date || today(), title: state.title,
      });
      done(round);
    } catch (err) {
      toast(err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save round';
    }
  });

  function done(round) {
    view.destroy();
    view = null;
    main.replaceChildren(card(
      h('h2', {}, '✅ Round saved'),
      h('img', { class: 'preview', src: round.photoUrl, alt: '' }),
      h('p', {}, `Released: ${formatDate(round.date)}. Hand the phone to a player (or play it yourself).`),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn primary', href: `#/play/${round.id}` }, '▶ Play it'),
        h('a', { class: 'btn', href: '#/rounds' }, 'All rounds'),
        h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, '+ Host another')),
    ));
  }

  main.append(
    card(
      h('h2', {}, '1. Photo'),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'btn', onclick: () => camInput.click() }, '📷 Take photo'),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, '🖼 Choose photo')),
      camInput, fileInput, preview),
    card(
      h('h2', {}, '2. Where was it taken?'),
      mapSelect,
      hint),
    box,
    card(
      h('h2', {}, 'Camera direction'),
      heading.el,
      compass.el,
      compassNote),
    card(
      h('h2', {}, '3. Difficulty'),
      difficulty.el,
      maxText),
    card(
      h('h2', {}, '4. Release date'),
      h('label', { class: 'field' }, h('span', {}, 'Shows as the daily round on'), date),
      h('label', { class: 'field' }, h('span', {}, 'Title (optional)'), title)),
    h('div', { class: 'sticky-actions' }, saveBtn),
  );
  useMap(state.map);
  return () => { compass.stop(); view?.destroy(); };
}
