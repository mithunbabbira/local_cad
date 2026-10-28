import * as C from '../core.js';
/**
 * Duplicate with "repeat": when the selection is the previous duplicate and it was moved/rotated/scaled,
 * the next duplicate applies the same transform again (like Tinkercad's Duplicate & Repeat).
 * Returns { copies, lastDup, repeated }.
 */
export function duplicateSelection(selNodes, lastDup, byId) {
  let delta = null;
  if (lastDup && selNodes.length === 1 && selNodes[0].id === lastDup.dup) { const src = byId(lastDup.src); if (src) delta = C.nodeMatrix(selNodes[0]).multiply(C.nodeMatrix(src).invert()); }
  const copies = selNodes.map(n => { const c = C.cloneNode(n); if (delta) C.setNodeMatrix(c, delta.clone().multiply(C.nodeMatrix(n))); return c; });
  return { copies, lastDup: selNodes.length === 1 ? { src: selNodes[0].id, dup: copies[0].id } : null, repeated: !!delta };
}
