// Tests for the UI-side modules: undo history, duplicate & repeat, file import, keyboard map.
import * as U from '../build/ui.mjs';
const { C } = U; const THREE = C.THREE;
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok - ' + name); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const near = (a, b, e = 1e-3) => { if (Math.abs(a - b) > e) throw new Error(`expected ${b} got ${a}`); };

t('undo/redo walks snapshots and restores the selection', () => {
  const h = new U.History(); let state = { nodes: [], sel: [] }; const snap = () => JSON.stringify(state);
  h.push(snap()); state = { nodes: ['a'], sel: ['a'] }; h.push(snap()); state = { nodes: ['a', 'b'], sel: ['b'] };
  state = JSON.parse(h.undo(snap())); eq(state, { nodes: ['a'], sel: ['a'] });
  state = JSON.parse(h.undo(snap())); eq(state, { nodes: [], sel: [] }); eq(h.undo(snap()), null, 'nothing left');
  state = JSON.parse(h.redo(snap())); eq(state.sel, ['a']); state = JSON.parse(h.redo(snap())); eq(state.sel, ['b']); eq(h.redo(snap()), null);
});
t('a new change clears redo; history is capped', () => {
  const h = new U.History(3); for (let i = 0; i < 5; i++) h.push(String(i)); eq(h.undoStack, ['2', '3', '4']);
  h.undo('5'); if (!h.canRedo) throw new Error('should redo'); h.push('x'); if (h.canRedo) throw new Error('redo must clear');
});
t('duplicate & repeat applies the previous move again', () => {
  const a = C.makeNode('box'); const nodes = [a]; const byId = id => nodes.find(n => n.id === id);
  let r = U.duplicateSelection([a], null, byId); eq(r.repeated, false); const d1 = r.copies[0]; nodes.push(d1); near(d1.pos[0], 0);
  if (d1.id === a.id) throw new Error('fresh id');
  d1.pos = [25, 0, 0]; d1.rot = [0, 0, 15];
  r = U.duplicateSelection([d1], r.lastDup, byId); eq(r.repeated, true); const d2 = r.copies[0]; nodes.push(d2);
  near(d2.rot[2], 30); const m = C.nodeMatrix(d2); const p = new THREE.Vector3().setFromMatrixPosition(m); near(p.length(), 50, 0.5);
  r = U.duplicateSelection([d2], r.lastDup, byId); near(r.copies[0].rot[2], 45);
});
t('duplicating several shapes does not repeat', () => {
  const a = C.makeNode('box'), b = C.makeNode('sphere'); const r = U.duplicateSelection([a, b], { src: a.id, dup: b.id }, () => a);
  eq(r.repeated, false); eq(r.copies.length, 2); eq(r.lastDup, null);
});
const tri = '0 0 0 10 0 0 0 10 0';
t('import ASCII STL', () => {
  const stl = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t`;
  const n = U.importFile('/Users/me/part.stl', new TextEncoder().encode(stl)); eq(n.type, 'mesh'); eq(n.name, 'part');
  eq(C.worldGeometry(n).attributes.position.count, 3);
});
t('import binary STL', () => {
  const buf = new ArrayBuffer(84 + 50); const dv = new DataView(buf); dv.setUint32(80, 1, true); tri.split(' ').map(Number).forEach((v, i) => dv.setFloat32(84 + 12 + i * 4, v, true));
  const n = U.importFile('b.STL', buf); eq(C.worldGeometry(n).attributes.position.count, 3);
  const bb = C.bbox([n]); near(bb.max.x - bb.min.x, 10);
});
t('import OBJ (quad is triangulated) and reject empty files', () => {
  const n = U.importFile('q.obj', new TextEncoder().encode('v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nf 1 2 3 4\n'));
  eq(C.worldGeometry(n).attributes.position.count, 6); eq(U.importFile('e.stl', new Uint8Array(0)), null);
});
t('import round-trips through save/load', () => {
  const n = U.importFile('q.obj', new TextEncoder().encode('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n'));
  const d = C.deserialize(C.serialize([n], null, {})); eq(C.worldGeometry(d.nodes[0]).attributes.position.count, 3);
});
t('keyboard map', () => {
  eq(U.keyAction({ key: 'W' }).action, 'workplane'); eq(U.keyAction({ key: 'r' }).action, 'ruler'); eq(U.keyAction({ key: 't' }).action, 'mode:translate');
  eq(U.keyAction({ key: 'ArrowLeft', shiftKey: true }), { action: 'nudge', axis: 0, amount: -10 }); eq(U.keyAction({ key: 'ArrowUp', metaKey: true }, 0.5), { action: 'nudge', axis: 2, amount: 0.5 });
  eq(U.keyAction({ key: 'd', ctrlKey: true }), null); eq(U.keyAction({ key: 'z' }), null);
});
t('grid geometry has one line per step each way', () => { eq(U.gridGeom(20, 10, 10).attributes.position.count, (3 + 2) * 2); });
console.log(`\n${pass} ui tests passed`);
