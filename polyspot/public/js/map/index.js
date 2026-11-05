// Map layer. Views talk only to the interface below, never to SVG or Leaflet directly.
//
// To add a real campus map later:
//   1. add a coordinate system to /shared/geo.js (a `latlng` one is already there and tested),
//   2. write an adapter (e.g. leaflet.js) that implements the same methods, and register it here.
// Scoring, rounds, host/player/results views stay as they are.
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
//   view.destroy()
//
// Positions are whatever the map's coordinate system uses ({ x, y } meters here, { lat, lng } later);
// headings are degrees clockwise, 0 = map up / north.
import { createFloorplanView } from './floorplan.js';

const adapters = {
  floorplan: createFloorplanView,
  // latlng: createLeafletView,
};

export function createMapView(container, map) {
  const make = adapters[map.type];
  if (!make) throw new Error(`No map adapter for map type "${map.type}"`);
  return make(container, map);
}
