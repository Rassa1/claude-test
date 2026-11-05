// Hash router. Each view renders into a fresh container and may return a cleanup function.
import { home } from './views/home.js';
import { host } from './views/host.js';
import { mapEditor } from './views/mapEditor.js';
import { play } from './views/play.js';
import { result } from './views/result.js';
import { playToday, rounds } from './views/rounds.js';
import { loadRuntime } from './runtime.js';
import { h } from './ui.js';
import { about } from './views/about.js';

const routes = [
  [/^#?\/?$/, home],
  [/^#\/host$/, host],
  [/^#\/about$/, about],
  [/^#\/map(?:\/([\w-]+))?$/, mapEditor],
  [/^#\/rounds$/, rounds],
  [/^#\/play\/today$/, playToday],
  [/^#\/play\/([\w-]+)$/, play],
  [/^#\/result\/([\w-]+)(?:\/([\w-]+))?$/, result],
];

const app = document.getElementById('app');
let cleanup = null;

async function render() {
  try { cleanup?.(); } catch (err) { console.error(err); } // never let a cleanup error block navigation
  cleanup = null;
  const route = routes.find(([re]) => re.test(location.hash));
  if (!route) return location.replace('#/');
  const container = h('div', { class: 'view' });
  app.replaceChildren(container);
  window.scrollTo(0, 0);
  try {
    const done = await route[1](container, ...location.hash.match(route[0]).slice(1));
    if (typeof done === 'function') {
      if (container.isConnected) cleanup = done;
      else done(); // user already navigated away
    }
  } catch (err) {
    console.error(err);
    container.append(h('main', { class: 'page' }, h('section', { class: 'card' },
      h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, err.message), h('a', { class: 'btn', href: '#/' }, 'Home'))));
  }
}

window.addEventListener('hashchange', render);
loadRuntime().then(render);
