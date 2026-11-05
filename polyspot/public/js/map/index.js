// Map layer. Views talk only to the interface below, never to SVG or Leaflet directly.
//
// Two adapters so far: floorplan.js (to-scale rectangle, { x, y } meters) and leaflet.js (satellite/street
// map, { lat, lng }). Each map's `type` picks one; its coordinate system lives in /shared/geo.js.
// Scoring, rounds, host/player/results views don't care which one is used.
//
// createMapView(container, map) → view
//   view.setMap(map)                      redraw the base layer (outline, grid, labeled features)
//   view.setPoses([{ id, pos, heading, color, label, labelSide }])
//                                         markers with a direction arrow and a view cone (results)
//   view.setLines([{ a, b, color }])      e.g. guess ↔ truth
//   view.editPose({ value, color, label, onChange }) → { set(partial), get(), stop() }
//                                         let the user place a position and aim a heading
//   view.pickPoint(onPick)                the next tap on the map calls onPick(pos) (placing features)
//   view.stopEditing()
//   view.focus(positions)                 zoom to show these positions (results); no-op if the whole map fits
//   view.hints = { place, adjust }        instructions matching the adapter's gestures
//   view.currentBounds?.()                visible area as { sw, ne } (real-world maps only)
//   view.destroy()
//
// Positions are whatever the map's coordinate system uses ({ x, y } meters here, { lat, lng } later);
// headings are degrees clockwise, 0 = map up / north.
import { createFloorplanView } from './floorplan.js';
import { createLeafletView } from './leaflet.js';

const adapters = {
  floorplan: createFloorplanView,
  latlng: createLeafletView,
};

export function createMapView(container, map) {
  const make = adapters[map.type];
  if (!make) throw new Error(`No map adapter for map type "${map.type}"`);
  return make(container, map);
}
