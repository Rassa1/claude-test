// Player mode: full-screen photo ↔ map. Tap to place, drag to aim, submit.
import { api } from '../api.js';
import { difficultyBadge, headingControl, maxPointsText } from '../components.js';
import { createMapView } from '../map/index.js';
import { formatDate, h, toast } from '../ui.js';

export async function play(root, id) {
  const [round, maps] = await Promise.all([api.round(id), api.maps()]);
  const map = maps.find(m => m.id === round.mapId);
  if (!map) throw new Error('This round’s map is missing.');

  let guess = { pos: null, heading: 0 };
  const wrap = h('div', { class: 'play', 'data-view': 'photo' });
  const show = v => { wrap.dataset.view = v; };

  // photo pane
  const img = h('img', { class: 'photo', src: round.photoUrl, alt: 'Where was this taken?' });
  const scroller = h('div', { class: 'photo-scroll', onclick: () => scroller.classList.toggle('zoomed') }, img);
  const info = h('div', { class: 'overlay-top' },
    h('a', { class: 'icon-btn', href: '#/rounds', 'aria-label': 'Leave round' }, '✕'),
    h('div', { class: 'overlay-info' },
      h('strong', {}, round.title || formatDate(round.date)), ' ', difficultyBadge(round.difficulty),
      h('div', { class: 'small' }, maxPointsText(round.difficulty))));
  const photoPane = h('section', { class: 'pane photo-pane' }, scroller, info,
    h('div', { class: 'overlay-bottom' },
      h('span', { class: 'small muted' }, 'Tap photo to zoom'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => show('map') }, 'Guess on map →')));

  // map pane
  const box = h('div', { class: 'map-box fill' });
  const hint = h('p', { class: 'hint' });
  const submit = h('button', { type: 'button', class: 'btn primary grow', disabled: true }, 'Submit guess');
  const heading = headingControl({ value: 0, onInput: deg => { guess.heading = deg; editor.set({ heading: deg }); } });
  const mapPane = h('section', { class: 'pane map-pane' },
    h('div', { class: 'map-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back to photo', onclick: () => show('photo') }, '‹'),
      hint),
    h('div', { class: 'map-stage' }, box,
      h('button', { type: 'button', class: 'peek', 'aria-label': 'Show photo', onclick: () => show('photo') }, h('img', { src: round.photoUrl, alt: '' }))),
    h('div', { class: 'map-controls' },
      heading.el,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => show('photo') }, '📷 Photo'),
        submit)));

  wrap.append(photoPane, mapPane);
  root.append(wrap);

  const view = createMapView(box, map);
  hint.textContent = view.hints.place;
  const editor = view.editPose({
    value: guess, color: 'var(--guess)', label: 'You',
    onChange: v => {
      guess = v;
      heading.set(v.heading);
      submit.disabled = !v.pos;
      hint.textContent = view.hints.adjust;
    },
  });

  submit.addEventListener('click', async () => {
    if (!guess.pos) return;
    submit.disabled = true;
    submit.textContent = 'Scoring…';
    try {
      const res = await api.guess(round.id, guess);
      location.hash = `#/result/${round.id}/${res.guess.id}`;
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Submit guess';
    }
  });

  return () => view.destroy();
}
