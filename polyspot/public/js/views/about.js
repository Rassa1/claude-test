// About & licenses: the credits and notices that third-party licenses and map terms ask us to show.
import { card, page } from '../components.js';
import { runtime } from '../runtime.js';
import { h } from '../ui.js';

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

export function about(root) {
  const main = page(root, 'About & licenses');
  const esri = !!runtime.info?.esriApiKey;
  main.append(
    card(
      h('h2', {}, 'PolySpot'),
      h('p', {}, 'A photo-location guessing game: find where a photo was taken and which way the camera faced.'),
      h('p', { class: 'small muted' }, 'An independent student project. Not affiliated with, sponsored by, or endorsed by Cal Poly Pomona, the California State University, or GeoGuessr.'),
      h('p', { class: 'small' }, 'PolySpot’s code is released under the ', link('/LICENSE.txt', 'MIT License'), '. Full notices: ', link('/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES'), '.')),
    card(
      h('h2', {}, 'Map imagery & data'),
      h('ul', { class: 'credits' },
        h('li', {}, h('strong', {}, 'Satellite (USGS): '), 'Imagery: USDA, ', link('https://www.usgs.gov/programs/national-geospatial-program/national-map', 'USGS The National Map'), '.'),
        esri ? h('li', {}, h('strong', {}, 'Satellite (Esri): '), 'Powered by ', link('https://www.esri.com', 'Esri'), '. Esri, Maxar, Earthstar Geographics, and the GIS User Community.') : null,
        h('li', {}, h('strong', {}, 'Street map: '), '© ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), '.'),
        h('li', {}, h('strong', {}, 'Building names: '), '© ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), ', available under the ', link('https://opendatacommons.org/licenses/odbl/', 'Open Database License'), ', via the Overpass API.'))),
    card(
      h('h2', {}, 'Software'),
      h('ul', { class: 'credits' },
        h('li', {}, link('https://leafletjs.com', 'Leaflet'), ' 1.9.4: © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade. ', link('/vendor/leaflet/LICENSE', 'BSD 2-Clause License'), '.'),
        h('li', {}, link('https://github.com/kazuhikoarase/qrcode-generator', 'qrcode-generator'), ': © 2009 Kazuhiko Arase. ', link('/vendor/qrcode-generator.LICENSE', 'MIT License'), '. “QR Code” is a registered trademark of DENSO WAVE INCORPORATED.'))),
    card(
      h('h2', {}, 'Photos & privacy'),
      h('p', { class: 'small' }, 'Photos and guesses are stored only on the host’s laptop. Uploaded photos are shrunk and their location data (EXIF/GPS) is removed.'),
      h('p', { class: 'small' }, 'Only upload photos you took or have permission to use. Don’t include people who haven’t agreed, ID cards, screens, or room numbers, and follow campus housing rules about photos in shared spaces.')),
  );
}
