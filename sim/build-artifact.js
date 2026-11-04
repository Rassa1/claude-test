// Bundles the interactive simulator into one self-contained HTML file: dist/shuttle-sim.html
// (no server needed; open it in a browser).   `npm run build:sim`
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const between = (s, tag) => s.split(`<!-- ${tag} -->`)[1].split(`<!-- /${tag} -->`)[0].trim();
const script = code => { if (/<\/script/i.test(code)) throw new Error('inline script contains </script'); return `<script>\n${code}\n</script>`; };

const page = read('public/sim.html');
const config = JSON.parse(read('config.json'));
const out = [
  between(page, 'sim:head'),
  `<style>\n${read('public/style.css')}\n${read('public/sim.css')}\n</style>`,
  `<div class="sim-body">\n${between(page, 'sim:body')}\n</div>`,
  script(`window.SHUTTLE_NO_AUTOBOOT = true;\nwindow.SHUTTLE_CONFIG = ${JSON.stringify(config)};`),
  ...['core.js', 'sim/world.js', 'public/map.js', 'public/app.js', 'public/sim.js'].map(f => script(read(f))),
].join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/shuttle-sim.html'), out + '\n');
console.log(`dist/shuttle-sim.html (${(out.length / 1024).toFixed(0)} KB)`);
