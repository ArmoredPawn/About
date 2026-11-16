// Finds sea routes for the map's trade lanes in the background. A new game has hundreds of lanes to route
// round the land, and doing that on the page froze the map for a second or more.
// In: { key, from, to }. Out: { key, way } (way is null when there is no route by sea).

import { seaRoute } from '../engine/navy.js';

onmessage = ({ data: { key, from, to } }) => {
  let way = null;
  try { way = seaRoute(from, to); } catch { /* no route */ }
  postMessage({ key, way });
};
