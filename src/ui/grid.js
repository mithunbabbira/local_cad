import { THREE } from '../core.js';
/** Line-segment grid of w × d mm centred on the origin, one line every `step` mm (capped for safety). */
export function gridGeom(w, d, step) {
  const p = [], hw = w / 2, hd = d / 2;
  if (step > 0 && w / step <= 2000 && d / step <= 2000) {
    for (let x = -hw; x <= hw + 1e-6; x += step) p.push(x, -hd, 0, x, hd, 0);
    for (let y = -hd; y <= hd + 1e-6; y += step) p.push(-hw, y, 0, hw, y, 0);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
