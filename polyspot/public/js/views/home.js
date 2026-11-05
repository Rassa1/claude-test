import { api } from '../api.js';
import { card, page, qrBox } from '../components.js';
import { h } from '../ui.js';

export async function home(root) {
  const main = page(root, 'PolySpot', { back: null });
  main.append(
    h('p', { class: 'lead' }, 'Guess where a photo was taken — and which way the camera was facing.'),
    h('nav', { class: 'menu' },
      h('a', { class: 'btn big primary', href: '#/play/today' }, '▶  Play today’s round'),
      h('a', { class: 'btn big', href: '#/host' }, '📷  Host a round'),
      h('a', { class: 'btn big', href: '#/rounds' }, '🗂  All rounds & history'),
      h('a', { class: 'btn big', href: '#/map' }, '📐  Edit the map')),
  );

  const info = await api.info().catch(() => null);
  if (!info) return;
  const onLaptop = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const { http = [], https = [] } = info.urls || {};
  if (onLaptop && http.length) {
    main.append(card(
      h('h2', {}, 'Open on your phone'),
      h('p', { class: 'small muted' }, 'Same Wi-Fi as this laptop. Scan or type:'),
      qrBox(http[0]),
      h('p', { class: 'url' }, http.join('  ·  ')),
      https.length ? h('p', { class: 'small muted' }, 'With phone compass (HTTPS): ', h('span', { class: 'url' }, https[0])) : null,
    ));
  } else if (!window.isSecureContext && https.length) {
    const url = https.find(u => u.includes(location.hostname)) || https[0];
    main.append(card(h('p', { class: 'small muted' }, 'To use the phone compass while hosting, open ', h('a', { href: url }, url), '.')));
  }
}
