// Runs group CSG off the UI thread. Receives { key, node }, replies with flat position/normal arrays.
import * as C from './core.js';
self.onmessage = ({ data: { key, node } }) => {
  try {
    const g = C.computeGroup(node);
    const pos = new Float32Array(g.attributes.position.array), nrm = new Float32Array(g.attributes.normal ? g.attributes.normal.array : 0);
    self.postMessage({ key, pos, nrm }, [pos.buffer, nrm.buffer]);
  } catch (e) { self.postMessage({ key, error: String(e && e.message || e) }); }
};
