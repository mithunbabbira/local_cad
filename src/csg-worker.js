// Runs group CSG off the UI thread. Receives { key, node }, replies with flat position/normal arrays.
import * as C from './core.js';
self.onmessage = ({ data: { key, node } }) => {
  try {
    const g = C.computeGroup(node);
    const pos = new Float32Array(g.attributes.position.array), nrm = new Float32Array(g.attributes.normal ? g.attributes.normal.array : 0), col = new Float32Array(g.attributes.color ? g.attributes.color.array : 0);
    self.postMessage({ key, pos, nrm, col }, [pos.buffer, nrm.buffer, col.buffer]);
  } catch (e) { self.postMessage({ key, error: String(e && e.message || e) }); }
};
