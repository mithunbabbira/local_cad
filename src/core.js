// LocalCAD core: pure scene model, geometry, CSG and file formats (no DOM).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import fontData from './fonts/helvetiker_bold.typeface.json';

const font = new Font(fontData);
let nextId = 1;
export const uid = () => 'n' + (nextId++) + '_' + Math.random().toString(36).slice(2, 7);

export const SHAPES = {
  box: { label: 'Box', color: '#e8483b', params: { w: 20, d: 20, h: 20 } },
  cylinder: { label: 'Cylinder', color: '#f39c12', params: { r: 10, h: 20, sides: 48 } },
  sphere: { label: 'Sphere', color: '#2d9cdb', params: { r: 10, segments: 32 } },
  cone: { label: 'Cone', color: '#9b59b6', params: { r: 10, rTop: 0, h: 20, sides: 48 } },
  torus: { label: 'Torus', color: '#27ae60', params: { r: 10, tube: 3, sides: 48 } },
  wedge: { label: 'Wedge', color: '#16a085', params: { w: 20, d: 20, h: 20 } },
  pyramid: { label: 'Pyramid', color: '#f1c40f', params: { w: 20, d: 20, h: 20 } },
  tube: { label: 'Tube', color: '#d35400', params: { r: 10, wall: 2, h: 20, sides: 48 } },
  halfsphere: { label: 'Half Sphere', color: '#8e44ad', params: { r: 10, segments: 32 } },
  text: { label: 'Text', color: '#c0392b', params: { text: 'TEXT', size: 10, h: 4 } },
};

export function makeNode(type, extra = {}) {
  const def = SHAPES[type];
  return { id: uid(), type, name: def ? def.label : type, params: def ? { ...def.params } : {},
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: def ? def.color : '#888888',
    hole: false, locked: false, hidden: false, ...extra };
}

function clean(g) { // normalise: non-indexed, position+normal only
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.computeVertexNormals(); return g;
}
function zUp(g, baseAtZero = true) { // three primitives are Y-up; LocalCAD is Z-up
  g.rotateX(Math.PI / 2); g.computeBoundingBox();
  if (baseAtZero) g.translate(0, 0, -g.boundingBox.min.z); return g;
}
function poly(verts, faces) {
  const p = []; for (const f of faces) for (let i = 1; i < f.length - 1; i++) p.push(...verts[f[0]], ...verts[f[i]], ...verts[f[i + 1]]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g;
}

export function primitiveGeometry(node) {
  const p = node.params; let g;
  switch (node.type) {
    case 'box': g = new THREE.BoxGeometry(p.w, p.d, p.h); g.translate(0, 0, p.h / 2); break;
    case 'cylinder': g = zUp(new THREE.CylinderGeometry(p.r, p.r, p.h, p.sides | 0)); break;
    case 'cone': g = zUp(new THREE.CylinderGeometry(Math.max(p.rTop, 0), p.r, p.h, p.sides | 0)); break;
    case 'sphere': g = new THREE.SphereGeometry(p.r, p.segments | 0, Math.max(4, (p.segments | 0) / 2)); g.translate(0, 0, p.r); break;
    case 'halfsphere': {
      const s = p.segments | 0, pts = [];
      for (let i = 0; i <= s / 2; i++) { const a = (i / (s / 2)) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * p.r, Math.sin(a) * p.r)); }
      pts.unshift(new THREE.Vector2(0, 0)); pts[pts.length - 1].x = 0;
      g = zUp(new THREE.LatheGeometry(pts, s)); g = clean(g); g = flipIfInverted(g); break; }
    case 'torus': g = new THREE.TorusGeometry(p.r, p.tube, Math.max(8, (p.sides | 0) / 2), p.sides | 0); g.translate(0, 0, p.tube); break;
    case 'tube': {
      const sh = new THREE.Shape(); sh.absarc(0, 0, p.r, 0, Math.PI * 2, false);
      const hole = new THREE.Path(); hole.absarc(0, 0, Math.max(0.01, p.r - p.wall), 0, Math.PI * 2, true); sh.holes.push(hole);
      g = new THREE.ExtrudeGeometry(sh, { depth: p.h, bevelEnabled: false, curveSegments: p.sides | 0 }); break; }
    case 'wedge': { const w = p.w / 2, d = p.d / 2, h = p.h;
      g = poly([[-w, -d, 0], [w, -d, 0], [w, d, 0], [-w, d, 0], [-w, d, h], [w, d, h]],
        [[0, 3, 2, 1], [0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5]]); break; }
    case 'pyramid': { const w = p.w / 2, d = p.d / 2;
      g = poly([[-w, -d, 0], [w, -d, 0], [w, d, 0], [-w, d, 0], [0, 0, p.h]],
        [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]); break; }
    case 'text': {
      g = new TextGeometry(String(p.text || ' '), { font, size: p.size, depth: p.h, height: p.h, curveSegments: 6, bevelEnabled: false });
      g.computeBoundingBox(); const b = g.boundingBox;
      g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z); break; }
    case 'mesh': g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(meshPositions(node), 3)); break;
    default: throw new Error('unknown shape ' + node.type);
  }
  return clean(g);
}
function flipIfInverted(g) { // ensure outward normals using signed volume
  if (signedVolume(g) < 0) flip(g); return g;
}
function flip(g) {
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
  g.attributes.position.needsUpdate = true; g.computeVertexNormals();
}
export function signedVolume(g) {
  const a = g.attributes.position.array; let v = 0;
  for (let i = 0; i < a.length; i += 9)
    v += (a[i] * (a[i + 4] * a[i + 8] - a[i + 5] * a[i + 7]) - a[i + 1] * (a[i + 3] * a[i + 8] - a[i + 5] * a[i + 6]) + a[i + 2] * (a[i + 3] * a[i + 7] - a[i + 4] * a[i + 6])) / 6;
  return v;
}

export function nodeMatrix(n) {
  const m = new THREE.Matrix4(); const d = THREE.MathUtils.degToRad;
  m.compose(new THREE.Vector3(...n.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(d(n.rot[0]), d(n.rot[1]), d(n.rot[2]))), new THREE.Vector3(...n.scale));
  return m;
}
export function setNodeMatrix(n, m) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q); const r = THREE.MathUtils.radToDeg;
  n.pos = p.toArray().map(round); n.rot = [r(e.x), r(e.y), r(e.z)].map(round); n.scale = s.toArray().map(round);
}
const round = v => Math.round(v * 1e4) / 1e4;

function bake(g, m) { g = g.clone(); g.applyMatrix4(m); if (m.determinant() < 0) flip(g); else g.computeVertexNormals(); return g; }

const evaluator = new Evaluator(); evaluator.attributes = ['position', 'normal']; evaluator.useGroups = false;
// Geometry cache keyed by *shape content* (type+params, or group structure), not by object identity.
// Small LRU so long sessions don't grow memory without bound.
const cache = new Map(); const CACHE_MAX = 400;
function cacheGet(k) { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v); } return v; }
export function cachePut(k, v) { cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
export function cacheHas(k) { return cache.has(k); }
const mkey = n => n.pos.join(',') + '|' + n.rot.join(',') + '|' + n.scale.join(',');
/** Stable content key: two nodes with the same key always produce identical local geometry. */
export function geoKey(n) {
  if (n.type === 'mesh') return 'mesh:' + (n.params.hash || (n.params.hash = hashPositions(meshPositions(n))));
  if (n.type !== 'group') return n.type + JSON.stringify(n.params);
  return 'g(' + n.children.map(c => (c.hole ? 'H' : 'S') + geoKey(c) + '@' + mkey(c)).join(';') + ')';
}
/** Run fn with async CSG disabled (exports, measurements that must be exact). */
export function syncCSG(fn) { const a = csgHooks.async; csgHooks.async = null; try { return fn(); } finally { csgHooks.async = a; } }
export function geometryFromArrays(pos, nrm) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (nrm && nrm.length) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); else g.computeVertexNormals(); return g; }
/** Optional async CSG hook (set by the app to offload groups to a Web Worker). */
export const csgHooks = { async: null };
/** Local-space geometry of a node (for groups: CSG of children, holes subtracted). */
export function localGeometry(n, opts = {}) {
  const k = geoKey(n); const hit = cacheGet(k); if (hit) return hit;
  if (n.type !== 'group') { const g = primitiveGeometry(n); cachePut(k, g); return g; }
  if (csgHooks.async && !opts.sync) { csgHooks.async(n, k); return placeholderGeometry(n); }
  const g = computeGroup(n); cachePut(k, g); return g;
}
export function computeGroup(n) {
  let solids = [], holes = [];
  for (const c of n.children) (c.hole ? holes : solids).push(bake(localGeometry(c, { sync: true }), nodeMatrix(c)));
  // A group made only of holes is itself a hole: keep the union of the holes as its shape.
  if (!solids.length) { solids = holes; holes = []; }
  if (!solids.length) return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  let acc = new Brush(solids[0]);
  for (let i = 1; i < solids.length; i++) acc = evaluator.evaluate(acc, new Brush(solids[i]), ADDITION);
  for (const h of holes) acc = evaluator.evaluate(acc, new Brush(h), SUBTRACTION);
  return clean(acc.geometry);
}
/** Cheap stand-in while a group's CSG is still computing: children merged without boolean ops. */
export function placeholderGeometry(n) {
  const kids = n.children.filter(c => !c.hole); const use = kids.length ? kids : n.children;
  const gs = use.map(c => bake(localGeometry(c), nodeMatrix(c))).filter(g => g.attributes.position.count);
  const g = gs.length ? mergeGeometries(gs) : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.userData.placeholder = true; return g;
}
const wcache = new Map();
export function worldGeometry(n) {
  const lg = localGeometry(n); const k = geoKey(n) + '#' + mkey(n);
  if (!lg.userData.placeholder) { const w = wcache.get(k); if (w) return w; }
  const g = bake(lg, nodeMatrix(n)); if (!lg.userData.placeholder) { wcache.set(k, g); if (wcache.size > 200) wcache.delete(wcache.keys().next().value); } return g;
}

export function groupNodes(nodes) {
  const g = makeNode('group', { name: 'Group', children: nodes.map(n => structuredClone(n)), hole: nodes.every(n => n.hole) });
  g.color = (nodes.find(n => !n.hole) || nodes[0]).color; g.multicolor = false; return g;
}
export function ungroupNode(g) {
  const gm = nodeMatrix(g);
  return g.children.map(c => { const n = structuredClone(c); setNodeMatrix(n, gm.clone().multiply(nodeMatrix(c))); return n; });
}
export function cloneNode(n) { const c = structuredClone(n); const re = x => { x.id = uid(); (x.children || []).forEach(re); }; re(c); return c; }

export function sceneGeometry(nodes) {
  const gs = nodes.filter(n => !n.hole && !n.hidden).map(worldGeometry).filter(g => g.attributes.position.count);
  return gs.length ? mergeGeometries(gs) : null;
}
export function toSTL(nodes) {
  const g = sceneGeometry(nodes); const a = g ? g.attributes.position.array : []; const tri = a.length / 9;
  const buf = new ArrayBuffer(84 + tri * 50), dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode('LocalCAD STL export'.padEnd(80, ' ')));
  dv.setUint32(80, tri, true); let o = 84; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < tri; t++) {
    const i = t * 9; A.fromArray(a, i); B.fromArray(a, i + 3); C.fromArray(a, i + 6);
    const nrm = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
    for (const v of [nrm, A, B, C]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
    o += 2;
  }
  return new Uint8Array(buf);
}
export function toOBJ(nodes) {
  let out = '# LocalCAD OBJ export (Z up, mm)\n', base = 1;
  for (const n of nodes.filter(n => !n.hole && !n.hidden)) {
    const g = mergeVertices(worldGeometry(n).clone().deleteAttribute('normal')); const p = g.attributes.position.array, idx = g.index.array;
    out += `o ${n.name.replace(/\s+/g, '_')}\n`;
    for (let i = 0; i < p.length; i += 3) out += `v ${round(p[i])} ${round(p[i + 1])} ${round(p[i + 2])}\n`;
    for (let i = 0; i < idx.length; i += 3) out += `f ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}\n`;
    base += p.length / 3;
  }
  return out;
}
export function parseSTL(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const pos = [];
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (u8.length === 84 + n * 50) { for (let t = 0; t < n; t++) { const o = 84 + t * 50 + 12; for (let k = 0; k < 9; k++) pos.push(dv.getFloat32(o + k * 4, true)); } }
  else { const s = new TextDecoder().decode(u8); const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m; while ((m = re.exec(s))) pos.push(+m[1], +m[2], +m[3]); }
  return pos;
}
export function parseOBJ(text) {
  const v = [], pos = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') { const ix = t.slice(1).map(s => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? v.length + i : i - 1; });
      for (let i = 1; i < ix.length - 1; i++) pos.push(...v[ix[0]], ...v[ix[i]], ...v[ix[i + 1]]); }
  }
  return pos;
}
export function meshPositions(n) {
  const p = n.params; if (p._f32) return p._f32;
  let f; if (p.b64) { const bin = typeof atob === 'function' ? Uint8Array.from(atob(p.b64), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(p.b64, 'base64')); f = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4); }
  else f = Float32Array.from(p.positions || []);
  Object.defineProperty(p, '_f32', { value: f, enumerable: false, configurable: true }); return f;
}
function toB64(f32) { const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); if (typeof btoa !== 'function') return Buffer.from(u8).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function hashPositions(f) { let h = 2166136261 >>> 0; const u = new Uint32Array(f.buffer, f.byteOffset, f.length); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(36) + '_' + f.length; }
export function meshNodeFromPositions(name, pos) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeBoundingBox();
  const b = g.boundingBox; const c = [-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z];
  const f = Float32Array.from(pos, (x, i) => x + c[i % 3]);
  return makeNode('mesh', { name, params: { b64: toB64(f), hash: hashPositions(f) }, color: '#7f8c8d' });
}
export function serialize(nodes, camera, settings) { return JSON.stringify({ format: 'localcad', version: 1, units: 'mm', nodes, camera, settings }); }
export function deserialize(text) {
  const d = JSON.parse(text); if (d.format !== 'localcad') throw new Error('Not a LocalCAD project'); return d;
}
export function bbox(nodes) {
  const b = new THREE.Box3(); for (const n of nodes) { const g = worldGeometry(n); g.computeBoundingBox(); b.union(g.boundingBox); } return b;
}
export { THREE };

// ---------- direct resize handles (math is DOM-free so it can be unit tested) ----------
/** Bounding box of a node's geometry in its own (unscaled, unrotated) frame. */
export function localBox(n) { const g = localGeometry(n); g.computeBoundingBox(); return g.boundingBox.clone(); }
/** Rotation-only quaternion of a node. */
export function nodeQuat(n) { const d = THREE.MathUtils.degToRad; return new THREE.Quaternion().setFromEuler(new THREE.Euler(d(n.rot[0]), d(n.rot[1]), d(n.rot[2]))); }
/** Current size (mm) along the node's local axes. */
export function localSize(n, box = localBox(n)) { const s = box.getSize(new THREE.Vector3()).toArray(); return s.map((v, i) => Math.abs(v * n.scale[i])); }
/** World position of a local-box point given by signs h (-1 min, 0 centre, +1 max). */
export function handlePoint(n, h, box = localBox(n)) {
  const p = [0, 1, 2].map(i => (h[i] < 0 ? box.min.getComponent(i) : h[i] > 0 ? box.max.getComponent(i) : (box.min.getComponent(i) + box.max.getComponent(i)) / 2));
  return new THREE.Vector3(...p).applyMatrix4(nodeMatrix(n));
}
/**
 * Resize like a bounding-box handle drag.
 * start: node at drag start. h: handle signs per local axis (0 = axis not driven).
 * dLocal: drag delta (mm) expressed in the node's rotated local frame.
 * opts: { uniform, centre, snap, min }. Opposite face stays anchored (or centre when opts.centre).
 */
export function resizeNode(start, h, dLocal, opts = {}, box = localBox(start)) {
  const { uniform = false, centre = false, snap = 0, min = 0.1 } = opts;
  const size = localSize(start, box); const want = size.slice();
  for (let i = 0; i < 3; i++) if (h[i]) {
    let v = size[i] + h[i] * dLocal[i] * (centre ? 2 : 1);
    if (snap) v = Math.round(v / snap) * snap;
    want[i] = Math.max(min, v);
  }
  let ratio = want.map((v, i) => (size[i] > 1e-9 ? v / size[i] : 1));
  if (uniform) { const act = [0, 1, 2].filter(i => h[i]); const f = act.reduce((a, i) => (Math.abs(ratio[i] - 1) > Math.abs(a - 1) ? ratio[i] : a), 1); ratio = [f, f, f]; }
  const n = structuredClone(start);
  n.scale = start.scale.map((s, i) => round(s * ratio[i]));
  // anchor point in unscaled local coords: opposite side of each driven axis, centre otherwise
  const a = [0, 1, 2].map(i => (centre || !h[i] ? (box.min.getComponent(i) + box.max.getComponent(i)) / 2 : h[i] > 0 ? box.min.getComponent(i) : box.max.getComponent(i)));
  if (uniform && !centre) for (let i = 0; i < 3; i++) if (!h[i]) a[i] = i === 2 ? box.min.getComponent(2) : a[i]; // uniform grows upward from the base
  const shift = new THREE.Vector3(...a.map((v, i) => v * (start.scale[i] - n.scale[i]))).applyQuaternion(nodeQuat(start));
  n.pos = start.pos.map((p, i) => round(p + shift.getComponent(i)));
  if (opts.keepOnPlane) { const z0 = bbox([start]).min.z; if (Math.abs(z0) < 1e-3) n.pos[2] = round(n.pos[2] - bbox([n]).min.z); }
  return n;
}
/** Set an exact size along one local axis (used by clickable dimension labels). */
export function setLocalSize(start, axis, value, opts = {}) {
  const size = localSize(start); const h = [0, 0, 0]; h[axis] = 1; const d = [0, 0, 0]; d[axis] = value - size[axis];
  return resizeNode(start, h, d, { ...opts, snap: 0 });
}
