import assert from 'node:assert/strict';
import * as C from '../build/core.mjs';
const vol = n => Math.abs(C.signedVolume(C.worldGeometry(n)));
let pass = 0; const t = (name, f) => { f(); pass++; console.log('ok -', name); };
t('box volume', () => { assert.ok(Math.abs(vol(C.makeNode('box')) - 8000) < 1e-3); });
for (const s of Object.keys(C.SHAPES)) t('shape builds + positive volume: ' + s, () => {
  const g = C.worldGeometry(C.makeNode(s)); assert.ok(g.attributes.position.count > 0); assert.ok(C.signedVolume(g) > 0, s + ' vol ' + C.signedVolume(g)); });
t('CSG union of overlapping boxes', () => {
  const a = C.makeNode('box'), b = C.makeNode('box'); b.pos = [10, 0, 0];
  const v = vol(C.groupNodes([a, b])); assert.ok(Math.abs(v - 12000) < 1, 'got ' + v); });
t('CSG subtract hole', () => {
  const a = C.makeNode('box'), h = C.makeNode('box', { hole: true }); h.pos = [10, 0, 0];
  const v = vol(C.groupNodes([a, h])); assert.ok(Math.abs(v - 4000) < 1, 'got ' + v); });
t('ungroup preserves world transform', () => {
  const a = C.makeNode('box'); a.pos = [5, 0, 0]; const g = C.groupNodes([a]); g.pos = [10, 0, 0]; g.rot = [0, 0, 90];
  const [u] = C.ungroupNode(g); assert.deepEqual(u.pos.map(Math.round), [10, 5, 0]); assert.equal(Math.round(u.rot[2]), 90); });
t('mirror (negative scale) keeps outward volume', () => { const a = C.makeNode('wedge'); a.scale = [-1, 1, 1]; assert.ok(C.signedVolume(C.worldGeometry(a)) > 0); });
t('STL export/import roundtrip', () => {
  const stl = C.toSTL([C.makeNode('box')]); assert.equal(stl.length, 84 + 12 * 50);
  const pos = C.parseSTL(stl); assert.equal(pos.length, 108);
  assert.ok(Math.abs(vol(C.meshNodeFromPositions('x', pos)) - 8000) < 1e-2); });
t('holes excluded from export', () => { assert.equal(C.toSTL([C.makeNode('box', { hole: true })]).length, 84); });
t('OBJ export/import roundtrip', () => {
  const obj = C.toOBJ([C.makeNode('cylinder')]); assert.match(obj, /^o Cylinder/m);
  const n = C.meshNodeFromPositions('x', C.parseOBJ(obj)); assert.ok(Math.abs(vol(n) - Math.PI * 100 * 20) < 40); });
t('project save/load roundtrip', () => {
  const g = C.groupNodes([C.makeNode('box'), C.makeNode('sphere', { hole: true })]);
  const d = C.deserialize(C.serialize([g])); assert.equal(d.nodes[0].children.length, 2);
  assert.ok(Math.abs(vol(d.nodes[0]) - vol(g)) < 1e-6); });
console.log(`\n${pass} tests passed`);
