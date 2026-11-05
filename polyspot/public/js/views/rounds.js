// Today's round + list of every round (for testing), and the "play today" redirect.
import { api } from '../api.js';
import { card, difficultyBadge, page } from '../components.js';
import { formatDate, h, points, toast, today } from '../ui.js';

export async function playToday(root) {
  const { round } = await api.today(today());
  if (round) return location.replace(`#/play/${round.id}`);
  const main = page(root, 'Today’s round');
  main.append(card(
    h('h2', {}, 'No round released today'),
    h('p', { class: 'muted' }, 'Host one with today’s date, or pick any round to test.'),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn primary', href: '#/host' }, '📷 Host a round'),
      h('a', { class: 'btn', href: '#/rounds' }, 'Pick a round'))));
}

export async function rounds(root) {
  const main = page(root, 'Rounds');
  const list = await api.rounds();
  const t = today();
  const todays = list.find(r => r.date === t);

  const row = r => {
    const del = h('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Delete round' }, '🗑');
    del.addEventListener('click', async () => {
      if (!confirm('Delete this round, its photo and its guess history?')) return;
      try { await api.deleteRound(r.id); li.remove(); toast('Deleted'); } catch (err) { toast(err.message, 'error'); }
    });
    const li = h('li', { class: 'round' },
      h('a', { class: 'thumb-link', href: `#/play/${r.id}` }, h('img', { src: r.photoUrl, alt: '', loading: 'lazy' })),
      h('div', { class: 'round-info' },
        h('strong', {}, r.title || 'Untitled round'),
        h('span', { class: 'small muted' },
          formatDate(r.date), r.date > t ? ' · scheduled' : '', ' · ', difficultyBadge(r.difficulty)),
        h('span', { class: 'small muted' }, r.plays ? `${r.plays} guess${r.plays > 1 ? 'es' : ''} · best ${points(r.best)}` : 'Not played yet')),
      h('div', { class: 'round-actions' },
        h('a', { class: 'btn small primary', href: `#/play/${r.id}` }, 'Play'),
        r.plays ? h('a', { class: 'btn small', href: `#/result/${r.id}` }, 'History') : null,
        del));
    return li;
  };

  main.append(
    card(
      h('h2', {}, `Today · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`),
      todays ? h('ul', { class: 'round-list' }, row(todays)) : h('p', { class: 'muted' }, 'No round released for today.')),
    card(
      h('div', { class: 'row between' }, h('h2', {}, 'All rounds'), h('a', { class: 'btn small', href: '#/host' }, '+ Host')),
      list.length ? h('ul', { class: 'round-list' }, list.map(row)) : h('p', { class: 'muted' }, 'No rounds yet.')),
  );
}
