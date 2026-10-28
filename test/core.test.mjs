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

const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const V = C.THREE ? null : null;
t('resize: +X side handle grows width, -X face anchored', () => {
  const b = C.makeNode('box'); const before = C.handlePoint(b, [-1, 0, 0]);
  const r = C.resizeNode(b, [1, 0, 0], [10, 0, 0]); near(C.localSize(r)[0], 30); near(C.localSize(r)[1], 20);
  near(C.handlePoint(r, [-1, 0, 0]).x, before.x); });
t('resize: corner handle resizes X+Y with opposite corner fixed', () => {
  const b = C.makeNode('box'); const opp = C.handlePoint(b, [-1, -1, 0]);
  const r = C.resizeNode(b, [1, 1, 0], [5, 10, 0]); assert.deepEqual(C.localSize(r).map(Math.round), [25, 30, 20]);
  const o2 = C.handlePoint(r, [-1, -1, 0]); near(o2.x, opp.x); near(o2.y, opp.y); });
t('resize: top handle changes height, base stays on plane', () => {
  const r = C.resizeNode(C.makeNode('cylinder'), [0, 0, 1], [0, 0, 15]); near(C.localSize(r)[2], 35); near(C.bbox([r]).min.z, 0); });
t('resize: snap rounds the resulting size', () => {
  const r = C.resizeNode(C.makeNode('box'), [1, 0, 0], [3.4, 0, 0], { snap: 5 }); near(C.localSize(r)[0], 25); });
t('resize: centre (Alt) grows both sides, centre fixed', () => {
  const b = C.makeNode('box'); const r = C.resizeNode(b, [1, 0, 0], [5, 0, 0], { centre: true });
  near(C.localSize(r)[0], 30); near(C.handlePoint(r, [0, 0, 0]).x, 0); });
t('resize: uniform (Shift) scales all axes proportionally', () => {
  const r = C.resizeNode(C.makeNode('box'), [1, 1, 0], [10, 0, 0], { uniform: true }); assert.deepEqual(C.localSize(r).map(Math.round), [30, 30, 30]); near(C.bbox([r]).min.z, 0); });
t('resize: rotated shape uses local axes and keeps anchor', () => {
  const b = C.makeNode('box'); b.rot = [0, 0, 90]; b.pos = [5, 5, 0]; const opp = C.handlePoint(b, [-1, 0, 0]);
  const r = C.resizeNode(b, [1, 0, 0], [10, 0, 0]); near(C.localSize(r)[0], 30);
  const o2 = C.handlePoint(r, [-1, 0, 0]); near(o2.x, opp.x); near(o2.y, opp.y);
  const w = C.bbox([r]).getSize(new (C.THREE.Vector3)()); near(w.y, 30); near(w.x, 20); });
t('resize: works on groups', () => {
  const a = C.makeNode('box'), c = C.makeNode('box'); c.pos = [20, 0, 0]; const g = C.groupNodes([a, c]);
  const r = C.resizeNode(g, [1, 0, 0], [20, 0, 0]); near(C.localSize(r)[0], 60); near(Math.abs(C.signedVolume(C.worldGeometry(r))), 24000, 1); });
t('resize: min size clamp and exact value setter', () => {
  near(C.localSize(C.resizeNode(C.makeNode('box'), [1, 0, 0], [-100, 0, 0]))[0], 0.1);
  near(C.localSize(C.setLocalSize(C.makeNode('sphere'), 2, 42.5))[2], 42.5); });
t('resize: mirrored shape keeps mirror sign', () => {
  const b = C.makeNode('box'); b.scale = [-1, 1, 1]; const r = C.resizeNode(b, [1, 0, 0], [10, 0, 0]); assert.ok(r.scale[0] < 0); near(C.localSize(r)[0], 30); });
t('group of only holes stays a (non-empty) hole', () => {
  const a = C.makeNode('box', { hole: true }), b = C.makeNode('cylinder', { hole: true }); b.pos = [15, 0, 0]; const g = C.groupNodes([a, b]);
  assert.ok(g.hole); assert.ok(C.localGeometry(g).attributes.position.count > 0);
  const s = C.makeNode('box', { params: { w: 60, d: 40, h: 10 } }); const v = Math.abs(C.signedVolume(C.worldGeometry(C.groupNodes([s, g]))));
  assert.ok(v < 24000 - 1000, 'hole group should cut: ' + v); });
t('group geometry is cached (second bbox is fast)', () => {
  const parts = []; for (let i = 0; i < 6; i++) { const s = C.makeNode(i % 2 ? 'sphere' : 'cylinder', { hole: i % 2 == 1 }); s.pos = [i * 8, 0, 0]; parts.push(s); }
  const g = C.groupNodes(parts); C.bbox([g]); const t0 = performance.now(); for (let i = 0; i < 20; i++) C.bbox([g]); const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 5, 'bbox ms ' + ms); });
t('imported mesh: compact storage, cheap cache key, survives JSON', () => {
  const pos = C.parseSTL(C.toSTL([C.makeNode('sphere', { params: { r: 10, segments: 64 } })])); const m = C.meshNodeFromPositions('m', pos);
  assert.ok(!m.params.positions && m.params.b64); const json = JSON.stringify(m); assert.ok(json.length < pos.length * 4 * 1.5, 'json ' + json.length);
  const back = JSON.parse(json); const t0 = performance.now(); for (let i = 0; i < 50; i++) C.localGeometry(back); assert.ok((performance.now() - t0) / 50 < 1);
  near(Math.abs(C.signedVolume(C.worldGeometry(back))), Math.abs(C.signedVolume(C.worldGeometry(m)))); });
t('legacy mesh projects with plain positions still load', () => {
  const m = C.makeNode('mesh', { params: { positions: Array.from(C.parseSTL(C.toSTL([C.makeNode('box')]))) } }); near(Math.abs(C.signedVolume(C.worldGeometry(m))), 8000, 1); });
t('resize keepOnPlane: tilted shape stays on the workplane', () => {
  const r = C.makeNode('box'); r.rot = [30, 0, 0]; r.pos[2] = -C.bbox([r]).min.z;
  const rr = C.resizeNode(r, [0, 0, 1], [0, 0, 10], { keepOnPlane: true }); near(C.bbox([rr]).min.z, 0); assert.ok(C.localSize(rr)[2] > 29); });
t('multi-select resize scales the group box and keeps the far side anchored', () => {
  const a = C.makeNode('box'), b = C.makeNode('box'); b.pos = [30, 0, 0];  // combined X: -10..40 (50 wide)
  const { nodes } = C.resizeMany([a, b], [1, 0, 0], [50, 0, 0]); const bb = C.bbox(nodes);
  near(bb.min.x, -10); near(bb.max.x, 90); near(C.localSize(nodes[0])[0], 40); near(nodes[1].pos[0], 70); near(bb.max.z, 20); });
t('multi-select uniform resize with Shift', () => {
  const a = C.makeNode('box'), b = C.makeNode('sphere'); b.pos = [30, 0, 0];
  const { nodes } = C.resizeMany([a, b], [1, 1, 0], [50, 0, 0], { uniform: true }); const s = C.bbox(nodes).getSize(new (C.THREE.Vector3)()); near(s.x, 100); near(s.z, 40); near(C.bbox(nodes).min.z, 0); });
t('angle snapping 22.5 / 45 / free', () => { assert.equal(C.snapAngle(30), 22.5); assert.equal(C.snapAngle(34), 45); assert.equal(C.snapAngle(30, { shift: true }), 45); assert.equal(C.snapAngle(30.4, { free: true }), 30); });
t('rotateAbout keeps the centre fixed and rotates about the axis', () => {
  const b = C.makeNode('box', { params: { w: 40, d: 10, h: 10 } }); const c = C.bbox([b]).getCenter(new (C.THREE.Vector3)());
  const [r] = C.rotateAbout([b], c.toArray(), [0, 0, 1], 90); near(r.rot[2], 90); const bb = C.bbox([r]); const s = bb.getSize(new (C.THREE.Vector3)());
  near(s.x, 10); near(s.y, 40); const c2 = bb.getCenter(new (C.THREE.Vector3)()); near(c2.x, c.x); near(c2.y, c.y); near(c2.z, c.z); });
t('rotateAbout on several nodes rotates them as one', () => {
  const a = C.makeNode('box'), b = C.makeNode('box'); b.pos = [40, 0, 0];
  const out = C.rotateAbout([a, b], [20, 0, 10], [0, 0, 1], 180); near(out[0].pos[0], 40); near(out[1].pos[0], 0); });
t('workplane frame from a surface + drop onto it', () => {
  const F = C.frameFromSurface([0, -10, 10], [0, -1, 0]);  // front face of a 20mm box
  const z = new (C.THREE.Vector3)().setFromMatrixColumn(F, 2); near(z.y, -1);
  const s = C.makeNode('sphere'); s.pos = [0, -40, 0]; const [d] = C.dropToFrame([s], F);
  const b = C.boxInFrame([d], F); near(b.min.z, 0); });
t('boxInFrame equals world bbox for identity frame (ruler distances)', () => {
  const b = C.makeNode('box'); b.pos = [15, 5, 3]; const bb = C.boxInFrame([b], new (C.THREE.Matrix4)()); near(bb.min.x, 5); near(bb.min.y, -5); near(bb.min.z, 3); });
console.log(`\n${pass} tests passed`);
