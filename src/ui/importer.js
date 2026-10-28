import * as C from '../core.js';
/** Turn an imported STL (binary/ASCII) or OBJ file into a mesh node; null when it has no triangles. */
export function importFile(name, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pos = /\.obj$/i.test(name) ? C.parseOBJ(new TextDecoder().decode(u8)) : C.parseSTL(u8);
  if (!pos.length) return null;
  return C.meshNodeFromPositions(name.replace(/^.*[\\/]/, '').replace(/\.\w+$/, ''), pos);
}
