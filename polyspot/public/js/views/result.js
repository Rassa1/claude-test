// Results: truth vs guess on the map, errors, points, and the guess history for the round.
import scoring from '/shared/scoring.config.js';
import { api } from '../api.js';
import { card, difficultyBadge, page } from '../components.js';
import { createMapView } from '../map/index.js';
import { formatLength } from '../units.js';
import { formatDate, formatTime, h, points } from '../ui.js';

export async function result(root, roundId, guessId) {
  const { round, map, truth, guesses } = await api.guesses(roundId);
  const main = page(root, 'Results', { back: '#/rounds' });
  if (!guesses.length) {
    main.append(card(h('p', {}, 'No guesses yet for this round.'), h('a', { class: 'btn primary', href: `#/play/${roundId}` }, '▶ Play it')));
    return;
  }

  const hero = h('div', { class: 'hero' });
  const stats = h('div', { class: 'stats' });
  const box = h('div', { class: 'map-box' });
  const historyList = h('ol', { class: 'history' });
  const view = createMapView(box, map);
  let current = guesses.find(g => g.id === guessId) || guesses.at(-1);

  const bar = (value, max, cls) => h('div', { class: `bar ${cls}` }, h('span', { style: { width: `${(100 * value) / max}%` } }));

  function show(g) {
    current = g;
    view.setPoses([
      { id: 'truth', pos: truth.pos, heading: truth.heading, color: 'var(--truth)', label: 'Actual', labelSide: 'left' },
      { id: 'guess', pos: g.pos, heading: g.heading, color: 'var(--guess)', label: 'You' },
    ]);
    view.setLines([{ a: g.pos, b: truth.pos }]);
    view.focus([g.pos, truth.pos]);
    hero.replaceChildren(
      h('div', { class: 'total' }, points(g.total)),
      h('div', { class: 'muted' }, `of ${points(g.max)} points`, g.multiplier !== 1 ? ` · includes ×${g.multiplier} difficulty bonus` : ''));
    stats.replaceChildren(
      h('div', { class: 'stat' },
        h('div', { class: 'stat-head' }, h('span', {}, '📍 Position'), h('strong', {}, `${points(g.position)} pts`)),
        bar(g.position, scoring.position.max, 'pos'),
        h('div', { class: 'small muted' }, `${formatLength(g.distance, map.units)} off`)),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-head' }, h('span', {}, '🧭 Direction'), h('strong', {}, `${points(g.direction)} pts`)),
        bar(g.direction, scoring.direction.max, 'dir'),
        h('div', { class: 'small muted' }, `${Math.round(g.angleError)}° off (you ${Math.round(g.heading)}°, actual ${Math.round(truth.heading)}°)`)));
    renderHistory();
  }

  function renderHistory() {
    const best = Math.max(...guesses.map(g => g.total));
    historyList.replaceChildren(...[...guesses].reverse().map((g, i) => h('li', {},
      h('button', { type: 'button', class: `history-row${g === current ? ' current' : ''}`, onclick: () => show(g) },
        h('span', { class: 'n' }, `#${guesses.length - i}`),
        h('span', { class: 'grow' }, formatTime(g.createdAt)),
        h('span', { class: 'small muted' }, `${formatLength(g.distance, map.units)} · ${Math.round(g.angleError)}°`),
        h('strong', {}, points(g.total), g.total === best ? ' ★' : '')))));
  }

  main.append(
    h('p', { class: 'center small muted' }, round.title || 'Round', ' · ', formatDate(round.date), ' · ', difficultyBadge(round.difficulty)),
    hero,
    box,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'swatch truth' }), 'Actual'),
      h('span', {}, h('i', { class: 'swatch guess' }), 'Your guess')),
    stats,
    h('div', { class: 'row' },
      h('a', { class: 'btn primary grow', href: `#/play/${roundId}` }, '↻ Try again'),
      h('a', { class: 'btn grow', href: '#/rounds' }, 'All rounds')),
    card(h('h2', {}, 'The photo'), h('a', { href: round.photoUrl, target: '_blank' }, h('img', { class: 'preview', src: round.photoUrl, alt: 'Round photo' }))),
    card(h('h2', {}, `Your guesses (${guesses.length})`), historyList),
  );
  show(current);
  return () => view.destroy();
}
