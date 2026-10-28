import * as C from './core.js';
import { THREE } from './core.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const $ = s => document.querySelector(s);
const view = $('#view'), status = m => ($('#status').textContent = m);
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// ---------- state ----------
let dirty = false, mode = 'handles', nodes = [], sel = [], undoStack = [], redoStack = [], lastDup = null, snap = 1, filePath = null;
// History entries capture nodes *and* the selection so undo/redo restores what was selected.
const snapshot = () => JSON.stringify({ nodes, sel });
function restore(snap) { const d = JSON.parse(snap); nodes = d.nodes; sel = d.sel || []; keepSel(); rebuild(); }
function commit() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; setDirty(true); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); setDirty(true); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); setDirty(true); }
function resetHistory() { undoStack = []; redoStack = []; lastDup = null; }
const byId = id => nodes.find(n => n.id === id);
const selected = () => sel.map(byId).filter(Boolean);
function keepSel() { sel = sel.filter(byId); }

// ---------- background CSG ----------
const csgPending = new Map(); let idleWaiters = [];
const computing = document.createElement('div'); computing.id = 'computing'; computing.textContent = 'Computing…'; document.body.appendChild(computing);
let csgWorker = null;
try { csgWorker = new Worker('csg-worker.bundle.js'); } catch (e) { console.warn('CSG worker unavailable, computing on main thread', e); }
if (csgWorker) {
  C.csgHooks.async = (n, key) => { if (csgPending.has(key)) return; csgPending.set(key, true); computing.style.display = 'block'; csgWorker.postMessage({ key, node: n }); };
  csgWorker.onmessage = ({ data }) => {
    csgPending.delete(data.key);
    if (data.error) status('CSG error: ' + data.error); else C.cachePut(data.key, C.geometryFromArrays(data.pos, data.nrm));
    if (!csgPending.size) { computing.style.display = 'none'; idleWaiters.forEach(f => f()); idleWaiters = []; }
    rebuild();
  };
}
const whenCsgIdle = () => (csgPending.size ? new Promise(r => idleWaiters.push(r)) : Promise.resolve());

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio); view.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9eef4');
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
const HOME = { pos: [-140, -200, 160], target: [0, 0, 0] };
camera.position.set(...HOME.pos);
scene.add(new THREE.HemisphereLight('#ffffff', '#8899aa', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-100, -150, 300); scene.add(sun);
const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true;
orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

// workplane: 200x200 mm, 1mm minor / 10mm major grid, blue plate like a build plate
const plane = new THREE.Group(); scene.add(plane);
const plate = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#d6e4f5', transparent: true, opacity: .85, side: THREE.DoubleSide }));
plate.position.z = -0.05; plane.add(plate);
const minor = new THREE.GridHelper(200, 200, '#b9cbe2', '#b9cbe2'); minor.rotation.x = Math.PI / 2; plane.add(minor);
const major = new THREE.GridHelper(200, 20, '#6c8fbf', '#8fabd0'); major.rotation.x = Math.PI / 2; major.position.z = 0.02; plane.add(major);
const axes = new THREE.AxesHelper(25); axes.position.z = 0.05; plane.add(axes);
let wp = new THREE.Matrix4(); // custom workplane frame (identity = default grid)
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
plane.matrixAutoUpdate = false;
function setWorkplane(m) { wp = m.clone(); plane.matrix.copy(wp); plane.matrixWorldNeedsUpdate = true;
  const nrm = new THREE.Vector3().setFromMatrixColumn(wp, 2).normalize(); groundPlane.setFromNormalAndCoplanarPoint(nrm, new THREE.Vector3().setFromMatrixPosition(wp));
  plate.material.color.set(isDefaultWP() ? '#d6e4f5' : '#f3e2b3'); settings.workplane = isDefaultWP() ? null : wp.toArray(); }
const isDefaultWP = () => wp.equals(new THREE.Matrix4());
const toWP = v => v.clone().applyMatrix4(wp.clone().invert()), fromWP = v => v.clone().applyMatrix4(wp);
const wpDir = v => v.clone().transformDirection(wp).multiplyScalar(v.length());

// gizmo
const tc = new TransformControls(camera, renderer.domElement); scene.add(tc.getHelper ? tc.getHelper() : tc);
tc.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; if (e.value) { commit(); dragStart = selected().map(n => C.nodeMatrix(n)); pivotStart = pivot.matrix.clone(); } else onGizmoEnd(); });
tc.addEventListener('objectChange', onGizmoChange);
const pivot = new THREE.Object3D(); scene.add(pivot);
let dragStart = null, pivotStart = null;
const meshes = new Map(); // id -> Object3D

function material(n) {
  if (n.hole) return new THREE.MeshStandardMaterial({ color: '#9aa4ad', transparent: true, opacity: .45, depthWrite: false, roughness: .6 });
  return new THREE.MeshStandardMaterial({ color: n.color, roughness: .55, metalness: .05, flatShading: n.type !== 'sphere' && n.type !== 'halfsphere' && n.type !== 'torus' });
}
function rebuild() {
  for (const m of meshes.values()) scene.remove(m); meshes.clear();
  for (const n of nodes) {
    let geo; try { geo = C.localGeometry(n); } catch (e) { console.error(e); status('Geometry error: ' + e.message); continue; }
    const mat = material(n); if (geo.userData.placeholder) { mat.transparent = true; mat.opacity = Math.min(mat.opacity, 0.5); }
    const m = new THREE.Mesh(geo, mat); m.userData.id = n.id; m.visible = !n.hidden;
    m.matrixAutoUpdate = false; m.matrix.copy(C.nodeMatrix(n)); m.matrixWorldNeedsUpdate = true;
    if (sel.includes(n.id)) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: '#1e6fd9' })); m.add(e); }
    scene.add(m); meshes.set(n.id, m);
  }
  attachGizmo(); renderProps(); updateRuler();
}
function attachGizmo() {
  const s = selected().filter(n => !n.locked);
  updateHandles();
  if (!s.length || mode === 'handles') { tc.detach(); return; }
  if (s.length === 1) { pivot.matrix.copy(C.nodeMatrix(s[0])); }
  else { const b = C.bbox(s); const c = b.getCenter(new THREE.Vector3()); c.z = b.min.z; pivot.matrix.makeTranslation(c.x, c.y, c.z); }
  pivot.matrix.decompose(pivot.position, pivot.quaternion, pivot.scale); pivot.updateMatrix();
  tc.attach(pivot);
}
function onGizmoChange() {
  pivot.updateMatrix();
  const delta = pivot.matrix.clone().multiply(pivotStart.clone().invert());
  selected().filter(n => !n.locked).forEach((n, i) => { C.setNodeMatrix(n, delta.clone().multiply(dragStart[i])); const m = meshes.get(n.id); if (m) m.matrix.copy(C.nodeMatrix(n)); });
  renderProps(true); updateRuler();
}
function onGizmoEnd() { rebuild(); }

// ---------- shape library ----------
const ICONS = { box: '■', cylinder: '▮', sphere: '●', cone: '▲', torus: '◎', wedge: '◣', pyramid: '△', tube: '○', halfsphere: '◓', text: 'T', hole_box: '▢', hole_cylinder: '◯' };
const lib = [...Object.keys(C.SHAPES).map(k => [k, C.SHAPES[k].label, false]), ['box', 'Box Hole', true], ['cylinder', 'Cylinder Hole', true]];
for (const [type, label, hole] of lib) {
  const d = document.createElement('div'); d.className = 'shape'; d.draggable = true;
  d.innerHTML = `<div style="font-size:22px;color:${hole ? '#889' : C.SHAPES[type].color}">${hole ? ICONS['hole_' + type] : ICONS[type]}</div>${label}`;
  d.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', JSON.stringify([type, hole])));
  d.addEventListener('click', () => addShape(type, hole, fromWP(new THREE.Vector3((nodes.length % 5) * 25 - 50, 0, 0))));
  $('#shapes').appendChild(d);
}
view.addEventListener('dragover', e => e.preventDefault());
view.addEventListener('drop', e => { e.preventDefault(); const [t, h] = JSON.parse(e.dataTransfer.getData('text/plain')); addShape(t, h, groundPoint(e) || new THREE.Vector3()); });
function addShape(type, hole, at) {
  commit(); const n = C.makeNode(type, { hole }); if (hole) n.name += ' (hole)';
  const l = toWP(at); const w = fromWP(new THREE.Vector3(snapV(l.x), snapV(l.y), 0));
  C.setNodeMatrix(n, new THREE.Matrix4().extractRotation(wp).setPosition(w)); nodes.push(n); sel = [n.id]; rebuild(); status(`Added ${n.name}`);
}
const snapV = v => (snap ? Math.round(v / snap) * snap : Math.round(v * 100) / 100);

// ---------- picking ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function setNdc(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function groundPoint(e) { setNdc(e); return ray.ray.intersectPlane(groundPlane, new THREE.Vector3()); }
let down = null, planeDrag = null;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || tc.dragging || tc.axis) return; down = [e.clientX, e.clientY];
  if (pickMode) { onPickClick(e); return; }
  if (handlePointerDown(e)) return;
  setNdc(e); const hit = ray.intersectObjects([...meshes.values()].filter(m => m.visible), false)[0];
  if (hit) {
    const id = hit.object.userData.id;
    if (e.shiftKey) sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]; else if (!sel.includes(id)) sel = [id];
    rebuild();
    // drag on the workplane (Tinkercad-style click-and-drag move)
    const s = selected().filter(n => !n.locked);
    if (s.length) { orbit.enabled = false; const p = groundPoint(e); planeDrag = { start: p, orig: s.map(n => [...n.pos]), moved: false }; }
  } else if (!e.shiftKey) { sel = []; rebuild(); }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!planeDrag || !planeDrag.start) return; const p = groundPoint(e); if (!p) return;
  if (!planeDrag.moved) { commit(); planeDrag.moved = true; }
  const l = toWP(p).sub(toWP(planeDrag.start)); const dW = wpDir(new THREE.Vector3(snapV(l.x), snapV(l.y), 0));
  selected().filter(n => !n.locked).forEach((n, i) => { n.pos = planeDrag.orig[i].map((v, k) => Math.round((v + dW.getComponent(k)) * 1e4) / 1e4); meshes.get(n.id).matrix.copy(C.nodeMatrix(n)); });
  renderProps(true); updateRuler(); updateHandles();
});
addEventListener('pointerup', () => { if (planeDrag) { orbit.enabled = true; if (planeDrag.moved) rebuild(); planeDrag = null; } });

// ---------- inspector ----------
function renderProps(soft) {
  const s = selected(); const body = $('#propbody');
  if (soft && document.activeElement && body.contains(document.activeElement)) return;
  if (!s.length) { body.innerHTML = `<p class="hint">Nothing selected.<br><br>Shortcuts: Ctrl/⌘+D duplicate (repeat), Ctrl/⌘+G group, Ctrl/⌘+Shift+G ungroup, H hole, S solid, D drop to workplane, M mirror, L align, Ctrl/⌘+L lock, Ctrl/⌘+Shift+H hide, Ctrl/⌘+Shift+A show all, arrows nudge (Shift ×10), Ctrl/⌘+↑/↓ raise/lower, F fit, Delete remove.</p>`; return; }
  const n = s[0]; const b = C.bbox(s); const sz = b.getSize(new THREE.Vector3());
  const num = (k, v, step = 1) => `<label>${k}<input data-k="${k}" type="number" step="${step}" value="${+(+v).toFixed(3)}"></label>`;
  let h = `<div><b>${s.length > 1 ? s.length + ' shapes' : n.name}</b>${n.locked ? ' 🔒' : ''}</div>
  <div class="row"><button data-x="solid" class="${!n.hole ? 'on' : ''}">Solid</button><button data-x="hole" class="${n.hole ? 'on' : ''}">Hole</button></div>
  <label>Color<input type="color" data-x="color" value="${n.color}"></label>`;
  if (s.length === 1) {
    h += `<h4>Position (mm)</h4>${num('X', n.pos[0])}${num('Y', n.pos[1])}${num('Z', n.pos[2])}
    <h4>Size (mm)</h4>${(ls => num('W', ls[0]) + num('D', ls[1]) + num('H', ls[2]))(C.localSize(n))}
    <h4>Rotation (°)</h4>${num('RX', n.rot[0], 15)}${num('RY', n.rot[1], 15)}${num('RZ', n.rot[2], 15)}`;
    if (n.type !== 'group' && n.type !== 'mesh') { h += '<h4>Parameters</h4>'; for (const [k, v] of Object.entries(n.params)) h += k === 'text' ? `<label>text<input data-p="text" value="${String(v).replace(/"/g, '&quot;')}"></label>` : `<label>${k}<input data-p="${k}" type="number" step="${k === 'sides' || k === 'segments' ? 1 : 0.5}" value="${v}"></label>`; }
  } else h += `<p class="hint">Selection size: ${sz.x.toFixed(2)} × ${sz.y.toFixed(2)} × ${sz.z.toFixed(2)} mm</p>`;
  h += `<h4>Align</h4>${['x', 'y', 'z'].map(a => `<div class="row">${a.toUpperCase()} <button data-al="${a}:min">min</button><button data-al="${a}:mid">mid</button><button data-al="${a}:max">max</button></div>`).join('')}
  <h4>Mirror</h4><div class="row"><button data-mi="0">X</button><button data-mi="1">Y</button><button data-mi="2">Z</button></div>
  <div class="row"><button data-x="lock">${n.locked ? 'Unlock' : 'Lock'}</button><button data-x="hide">Hide</button></div>`;
  body.innerHTML = h;
}
$('#propbody').addEventListener('change', e => {
  const t = e.target, s = selected(); if (!s.length) return; const n = s[0];
  if (t.dataset.x === 'color') { commit(); s.forEach(x => (x.color = t.value)); return rebuild(); }
  if (t.dataset.p) { commit(); n.params[t.dataset.p] = t.dataset.p === 'text' ? t.value : Math.max(0.01, +t.value); return rebuild(); }
  const k = t.dataset.k; if (!k) return; const v = +t.value; commit();
  if (k === 'X' || k === 'Y' || k === 'Z') n.pos['XYZ'.indexOf(k)] = v;
  else if (k[0] === 'R') n.rot['XYZ'.indexOf(k[1])] = v;
  else if (v > 0) { const i = 'WDH'.indexOf(k); nodes[nodes.indexOf(n)] = C.setLocalSize(n, i, v); }
  rebuild();
});
$('#propbody').addEventListener('click', e => {
  const d = e.target.dataset; if (d.x === 'solid') setHole(false); if (d.x === 'hole') setHole(true);
  if (d.x === 'lock') { commit(); const l = !selected()[0].locked; selected().forEach(n => (n.locked = l)); rebuild(); }
  if (d.x === 'hide') hide(); if (d.al) align(...d.al.split(':')); if (d.mi) mirror(+d.mi);
});

// ---------- operations ----------
function setHole(h) { if (!sel.length) return; commit(); selected().forEach(n => (n.hole = h)); rebuild(); }
function del() { if (!sel.length) return; commit(); nodes = nodes.filter(n => !sel.includes(n.id) || n.locked); sel = []; rebuild(); }
function duplicate() {
  const s = selected(); if (!s.length) return; commit();
  // Duplicate & repeat: if the current selection is the previous duplicate (and it was moved), repeat that transform.
  let delta = null;
  if (lastDup && s.length === 1 && s[0].id === lastDup.dup) { const src = byId(lastDup.src); if (src) delta = C.nodeMatrix(s[0]).multiply(C.nodeMatrix(src).invert()); }
  const copies = s.map(n => { const c = C.cloneNode(n); if (delta) C.setNodeMatrix(c, delta.clone().multiply(C.nodeMatrix(n))); return c; });
  nodes.push(...copies); lastDup = s.length === 1 ? { src: s[0].id, dup: copies[0].id } : null;
  sel = copies.map(c => c.id); rebuild(); status(delta ? 'Duplicated with repeated transform' : 'Duplicated – move it, then Ctrl/⌘+D again to repeat');
}
function group() {
  const s = selected(); if (s.length < 2) return status('Select 2+ shapes to group'); commit();
  const g = C.groupNodes(s);
  nodes = nodes.filter(n => !sel.includes(n.id)); nodes.push(g); sel = [g.id]; rebuild(); status('Grouped');
}
function ungroup() {
  const s = selected().filter(n => n.type === 'group'); if (!s.length) return; commit(); const out = [];
  for (const g of s) { const kids = C.ungroupNode(g); nodes.splice(nodes.indexOf(g), 1, ...kids); out.push(...kids.map(k => k.id)); }
  sel = out; rebuild();
}
function align(axis, mode) {
  const s = selected(); if (s.length < 2) return status('Select 2+ shapes to align'); commit();
  const i = 'xyz'.indexOf(axis), all = C.bbox(s); const tgt = mode === 'min' ? all.min.getComponent(i) : mode === 'max' ? all.max.getComponent(i) : all.getCenter(new THREE.Vector3()).getComponent(i);
  for (const n of s) { const b = C.bbox([n]); const cur = mode === 'min' ? b.min.getComponent(i) : mode === 'max' ? b.max.getComponent(i) : b.getCenter(new THREE.Vector3()).getComponent(i); n.pos[i] += tgt - cur; }
  rebuild();
}
function mirror(i) {
  const s = selected(); if (!s.length) return; commit(); const c = C.bbox(s).getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(...[0, 1, 2].map(k => (k === i ? -1 : 1)))).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  s.forEach(n => C.setNodeMatrix(n, m.clone().multiply(C.nodeMatrix(n)))); rebuild();
}
function drop() { const s = selected(); if (!s.length) return; commit(); C.dropToFrame(s, wp).forEach(x => (nodes[nodes.findIndex(y => y.id === x.id)] = x)); rebuild(); }
function nudge(i, d) { const s = selected().filter(n => !n.locked); if (!s.length) return; commit(); s.forEach(n => (n.pos[i] = Math.round((n.pos[i] + d) * 1e4) / 1e4)); rebuild(); }
function hide() { if (!sel.length) return; commit(); selected().forEach(n => (n.hidden = true)); sel = []; rebuild(); }
function showAll() { commit(); nodes.forEach(n => (n.hidden = false)); rebuild(); }

// ---------- ruler / dimensions overlay ----------
function updateRuler() { const s = selected(); if (!s.length) return status(`${nodes.length} shape(s) · snap ${snap || 'off'} mm`);
  const b = C.bbox(s), z = b.getSize(new THREE.Vector3()); status(`Selection: W ${z.x.toFixed(2)} × D ${z.y.toFixed(2)} × H ${z.z.toFixed(2)} mm · min (${b.min.x.toFixed(1)}, ${b.min.y.toFixed(1)}, ${b.min.z.toFixed(1)})`); }

// ---------- camera / view cube ----------
function fly(dir, dist) { const t = orbit.target.clone(); const d = dist || camera.position.distanceTo(t); camera.position.copy(t.clone().add(dir.clone().normalize().multiplyScalar(d))); camera.up.set(0, 0, 1); if (Math.abs(dir.z) > .99 && !dir.x && !dir.y) camera.up.set(0, 1, 0); camera.lookAt(t); orbit.update(); camera.up.set(0, 0, 1); }
function home() { orbit.target.set(...HOME.target); camera.position.set(...HOME.pos); orbit.update(); }
function fit() { const s = selected().length ? selected() : nodes.filter(n => !n.hidden); if (!s.length) return home(); const b = C.bbox(s); const c = b.getCenter(new THREE.Vector3()); const r = Math.max(10, b.getSize(new THREE.Vector3()).length());
  const dir = camera.position.clone().sub(orbit.target); orbit.target.copy(c); fly(dir, r * 1.8); }
const cubeR = new THREE.WebGLRenderer({ antialias: true, alpha: true }); cubeR.setSize(110, 110); cubeR.setPixelRatio(devicePixelRatio); $('#viewcube').appendChild(cubeR.domElement);
const cubeScene = new THREE.Scene(), cubeCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
const faceDefs = [['RIGHT', [1, 0, 0]], ['LEFT', [-1, 0, 0]], ['BACK', [0, 1, 0]], ['FRONT', [0, -1, 0]], ['TOP', [0, 0, 1]], ['BOTTOM', [0, 0, -1]]];
const faceMats = faceDefs.map(([l]) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#f4f7fb'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#8aa'; x.lineWidth = 6; x.strokeRect(0, 0, 128, 128); x.fillStyle = '#345'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(l, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }); });
const cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), faceMats);
// BoxGeometry face order is +x,-x,+y,-y,+z,-z; rotate TOP/BOTTOM textures readable in z-up by default is fine
cubeScene.add(cube); cubeScene.add(new THREE.AmbientLight('#fff'));
cubeR.domElement.addEventListener('click', e => { const r = cubeR.domElement.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(v, cubeCam); const h = rc.intersectObject(cube)[0]; if (!h) return;
  // corner/edge clicks: use rounded hit point so clicking near an edge gives an iso view
  const p = h.point.clone().multiplyScalar(1 / 0.8); const dir = new THREE.Vector3(...p.toArray().map(a => (Math.abs(a) > 0.6 ? Math.sign(a) : 0))); fly(dir); });
const homeBtn = document.createElement('button'); homeBtn.textContent = '⌂ Home'; homeBtn.style.cssText = 'position:absolute;top:112px;left:6px'; homeBtn.onclick = home; $('#viewcube').appendChild(homeBtn);
const fitBtn = document.createElement('button'); fitBtn.textContent = 'Fit'; fitBtn.style.cssText = 'position:absolute;top:112px;left:70px'; fitBtn.onclick = fit; $('#viewcube').appendChild(fitBtn);
const ortho = document.createElement('label'); $('#viewcube').appendChild(ortho);

function resize() { const r = view.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
function loop() { requestAnimationFrame(loop); orbit.update(); tickHandles(); updateRulerLabels(); renderer.render(scene, camera);
  const d = camera.position.clone().sub(orbit.target).normalize().multiplyScalar(4); cubeCam.position.copy(d); cubeCam.up.copy(camera.up); cubeCam.lookAt(0, 0, 0); cubeR.render(cubeScene, cubeCam); } requestAnimationFrame(loop);


// ---------- Tinkercad-style direct resize handles ----------
const hGroup = new THREE.Group(); hGroup.renderOrder = 10; scene.add(hGroup);
const hMat = { corner: new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }), side: new THREE.MeshBasicMaterial({ color: '#111111', depthTest: false }),
  top: new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }), lift: new THREE.MeshBasicMaterial({ color: '#1e6fd9', depthTest: false }),
  edge: new THREE.MeshBasicMaterial({ color: '#1e6fd9', depthTest: false }), hot: new THREE.MeshBasicMaterial({ color: '#ff7a00', depthTest: false }) };
const HANDLES = [
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, y]) => ({ kind: 'corner', h: [x, y, 0], at: [x, y, -1] })),
  ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ kind: 'side', h: [x, y, 0], at: [x, y, -1] })),
  { kind: 'top', h: [0, 0, 1], at: [0, 0, 1] }, { kind: 'lift', h: [0, 0, 0], at: [0, 0, 1] },
  ...[0, 1, 2].map(axis => ({ kind: 'rot', axis, h: [0, 0, 0] }))];
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineDashedMaterial({ color: '#1e6fd9', dashSize: 1.5, gapSize: 1, depthTest: false }));
hGroup.add(outline);
for (const H of HANDLES) {
  if (H.kind === 'rot') { // curved rotation arrow: quarter-torus + arrowhead
    const g = new THREE.Group(); const arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 32, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2b2f36', depthTest: false })); arc.renderOrder = 11;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 12), arc.material); tip.position.set(0, 1, 0); tip.rotation.z = Math.PI / 2; tip.renderOrder = 11;
    const tip2 = tip.clone(); tip2.position.set(1, 0, 0); tip2.rotation.z = Math.PI; g.add(arc, tip, tip2); arc.userData.handle = H; tip.userData.handle = H; tip2.userData.handle = H;
    H.mesh = g; H.pick = [arc, tip, tip2]; hGroup.add(g); continue; }
  const geo = H.kind === 'lift' ? new THREE.ConeGeometry(0.6, 1.4, 16).rotateX(Math.PI / 2) : H.kind === 'side' ? new THREE.BoxGeometry(0.9, 0.9, 0.9) : new THREE.BoxGeometry(1.1, 1.1, 1.1);
  H.mesh = new THREE.Mesh(geo, hMat[H.kind]); H.mesh.userData.handle = H; H.mesh.renderOrder = 11;
  if (H.kind !== 'lift' && H.kind !== 'side') { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#333', depthTest: false })); H.mesh.add(e); }
  hGroup.add(H.mesh);
}
const labelLayer = document.createElement('div'); labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; view.appendChild(labelLayer);
const LABELS = [{ axis: 0, at: [0, -1, -1], off: [0, -1, 0] }, { axis: 1, at: [1, 0, -1], off: [1, 0, 0] }, { axis: 2, at: [1, -1, 0], off: [1, -1, 0] }, { axis: 'z', at: [0, 0, -1], off: [0, 0, 0] }];
for (const L of LABELS) { L.el = document.createElement('div'); L.el.className = 'dimlabel'; L.el.style.pointerEvents = 'auto'; labelLayer.appendChild(L.el);
  L.el.addEventListener('pointerdown', e => e.stopPropagation()); L.el.addEventListener('click', () => editLabel(L)); }
let hTarget = null, hBox = null, hDrag = null;
function handleNode() { const s = selected(); if (mode !== 'handles' || !s.length || s.some(n => n.locked || n.hidden)) return null; return s.length === 1 ? s[0] : C.virtualNode(); }
const zMin = () => (hTarget.virtual ? C.handlePoint(hTarget, [0, 0, -1], hBox).z : C.bbox([hTarget]).min.z);
function updateHandles() {
  hTarget = hDrag ? hDrag.cur : handleNode(); hGroup.visible = !!hTarget; if (!hTarget) { LABELS.forEach(L => (L.el.style.display = 'none')); return; }
  hBox = hDrag ? hDrag.box : hTarget.virtual ? C.bbox(selected()) : C.localBox(hTarget);
  const m = C.nodeMatrix(hTarget); const q = C.nodeQuat(hTarget);
  const c = hBox.getCenter(new THREE.Vector3()), sz = hBox.getSize(new THREE.Vector3());
  outline.matrixAutoUpdate = false; outline.matrix.copy(m.clone().multiply(new THREE.Matrix4().compose(c, new THREE.Quaternion(), sz)));
  const top = C.handlePoint(hTarget, [0, 0, 1], hBox);
  const sizeW = C.localSize(hTarget, hBox), ctr = C.handlePoint(hTarget, [0, 0, 0], hBox);
  for (const H of HANDLES) {
    if (H.kind === 'rot') { placeRotArrow(H, q, ctr, sizeW); continue; }
    H.mesh.quaternion.copy(q);
    if (H.kind === 'lift') { H.mesh.position.copy(top).add(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(H.mesh.scale.x * 4 + 4)); }
    else H.mesh.position.copy(C.handlePoint(hTarget, H.at, hBox));
  }
  updateLabels();
}
function tickHandles() { if (!hGroup.visible) return; for (const H of HANDLES) { if (H.kind === 'rot') continue; const d = camera.position.distanceTo(H.mesh.position); H.mesh.scale.setScalar(d * 0.008); }
  if (hTarget) { const top = C.handlePoint(hTarget, [0, 0, 1], hBox); const L = HANDLES.find(x => x.kind === 'lift'); L.mesh.position.copy(top).add(new THREE.Vector3(0, 0, 1).applyQuaternion(C.nodeQuat(hTarget)).multiplyScalar(L.mesh.scale.x * 2.5 + 2)); }
  updateLabels(); }
function toScreen(v) { const p = v.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height, p.z]; }
function updateLabels() {
  if (!hTarget) return; const size = C.localSize(hTarget, hBox); const dragging = !!hDrag;
  for (const L of LABELS) {
    if (L.el.querySelector('input')) continue;
    let val, show = true;
    if (L.axis === 'z') { val = zMin(); show = Math.abs(val) > 1e-3 || (dragging && hDrag.H.kind === 'lift'); }
    else { val = size[L.axis]; if (dragging && hDrag.H.kind !== 'lift') show = !!hDrag.H.h[L.axis] || (hDrag.uniform); }
    const p = C.handlePoint(hTarget, L.at, hBox); const [x, y, z] = toScreen(p);
    const o = new THREE.Vector3(...L.off).applyQuaternion(C.nodeQuat(hTarget)); const [x2, y2] = toScreen(p.clone().add(o.multiplyScalar(6)));
    L.el.style.display = show && z < 1 ? 'block' : 'none'; L.el.style.left = (L.axis === 'z' ? x : x2) + 'px'; L.el.style.top = (L.axis === 'z' ? y : y2) + 'px';
    L.el.classList.toggle('active', dragging); L.el.textContent = (L.axis === 'z' ? '↑ ' : '') + (+val.toFixed(2)) + ' mm';
  }
}
function editLabel(L) {
  const n = hTarget; if (!n) return; const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any';
  inp.value = L.axis === 'z' ? +zMin().toFixed(3) : +C.localSize(n, hBox)[L.axis].toFixed(3); L.el.textContent = ''; L.el.appendChild(inp); inp.focus(); inp.select();
  const done = ok => { if (!inp.isConnected) return; const v = parseFloat(inp.value); inp.remove();
    if (ok && isFinite(v)) { commit();
      if (n.virtual) { const s = selected(); const box = C.bbox(s); let out;
        if (L.axis === 'z') { const dz = v - box.min.z; out = s.map(x => ({ ...x, pos: [x.pos[0], x.pos[1], x.pos[2] + dz] })); }
        else if (v > 0) { const h = [0, 0, 0], d = [0, 0, 0]; h[L.axis] = 1; d[L.axis] = v - C.localSize(n, box)[L.axis]; out = C.resizeMany(s, h, d, {}, box).nodes; } else out = s;
        out.forEach(x => (nodes[nodes.findIndex(y => y.id === x.id)] = x)); }
      else { const i = nodes.indexOf(n); nodes[i] = L.axis === 'z' ? { ...n, pos: [n.pos[0], n.pos[1], n.pos[2] + v - C.bbox([n]).min.z] } : v > 0 ? C.setLocalSize(n, L.axis, v) : n; }
      rebuild(); }
    else updateLabels(); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
}
// axis frames: X arrow sits on the -X face, Y arrow on the -Y face, Z arrow on the base (all facing the default camera)
const rotFrameQ = [0, 1, 2].map(i => { const q = new THREE.Quaternion(); if (i === 0) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
  else if (i === 1) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)); else q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI); return q; });
function rotGeom(H, q, ctr, size) {
  const i = H.axis, axis = new THREE.Vector3().setComponent(i, 1).applyQuaternion(q);
  const others = [0, 1, 2].filter(k => k !== i); const r = 0.5 * Math.hypot(size[others[0]], size[others[1]]) + 4;
  const off = i === 2 ? -size[2] / 2 : -size[i] / 2 - 1; const c = ctr.clone().add(axis.clone().multiplyScalar(off));
  return { axis, r, c };
}
function placeRotArrow(H, q, ctr, size) { const { r, c } = rotGeom(H, q, ctr, size); H.mesh.position.copy(c); H.mesh.quaternion.copy(q).multiply(rotFrameQ[H.axis]); H.mesh.scale.setScalar(r); H.mesh.visible = !hDrag || hDrag.H === H; }
const angleLabel = document.createElement('div'); angleLabel.className = 'dimlabel active'; angleLabel.style.display = 'none'; labelLayer.appendChild(angleLabel);
let rDrag = null;
function startRotate(H, e) {
  const n = hTarget, q = C.nodeQuat(n), size = C.localSize(n, hBox), ctr = C.handlePoint(n, [0, 0, 0], hBox);
  const { axis, c } = rotGeom(H, q, ctr, size); const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, c);
  const p0 = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (!p0) return false;
  commit(); orbit.enabled = false; H.pick[0].material = hMat.hot;
  rDrag = { H, axis, c, ctr, plane, v0: p0.sub(c).normalize(), starts: selected().map(x => structuredClone(x)), virt: n.virtual ? structuredClone(n) : null, box: hBox.clone(), deg: 0 };
  hDrag = { H, cur: n, box: hBox, startNode: structuredClone(n) }; e.preventDefault(); return true;
}
function applyRotate(p, mods) {
  const v = p.clone().sub(rDrag.c).normalize(); const cross = new THREE.Vector3().crossVectors(rDrag.v0, v);
  const raw = THREE.MathUtils.radToDeg(Math.atan2(cross.dot(rDrag.axis), rDrag.v0.dot(v)));
  const deg = snapAngle(raw, mods); rDrag.deg = deg;
  const out = C.rotateAbout(rDrag.starts, rDrag.ctr.toArray(), rDrag.axis.toArray(), deg);
  out.forEach(x => { nodes[nodes.findIndex(y => y.id === x.id)] = x; const m = meshes.get(x.id); if (m) m.matrix.copy(C.nodeMatrix(x)); });
  hDrag.cur = rDrag.virt ? C.rotateAbout([rDrag.virt], rDrag.ctr.toArray(), rDrag.axis.toArray(), deg)[0] : out[0];
  updateHandles(); renderProps(true); updateRuler();
  const [x, y] = toScreen(p); angleLabel.style.display = 'block'; angleLabel.style.left = x + 'px'; angleLabel.style.top = (y - 22) + 'px'; angleLabel.textContent = (deg > 0 ? '+' : '') + deg + '°';
}
const snapAngle = (d, m) => C.snapAngle(d, { shift: m.shift, free: m.alt || !snap });
function dragPlaneFor(H, n, point) {
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(C.nodeQuat(n));
  if (H.kind === 'corner' || H.kind === 'side') return new THREE.Plane().setFromNormalAndCoplanarPoint(zAxis, point);
  const axis = H.kind === 'lift' ? new THREE.Vector3(0, 0, 1) : zAxis; const v = camera.position.clone().sub(point);
  const nrm = v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize(); return new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, point);
}
function handlePointerDown(e) {
  if (!hGroup.visible || !hTarget) return false; setNdc(e);
  const hit = ray.intersectObjects(HANDLES.flatMap(H => H.pick || [H.mesh]), false)[0]; if (!hit) return false;
  const H = hit.object.userData.handle; if (H.kind === 'rot') return startRotate(H, e); const n = hTarget; const point = H.mesh.position.clone();
  const planeH = dragPlaneFor(H, n, point); const start = ray.ray.intersectPlane(planeH, new THREE.Vector3()); if (!start) return false;
  commit(); orbit.enabled = false; hit.object.material = hMat.hot;
  hDrag = { H, id: n.id, start, plane: planeH, startNode: structuredClone(n), cur: n, box: n.virtual ? C.bbox(selected()) : C.localBox(n), starts: selected().map(x => structuredClone(x)), uniform: e.shiftKey }; e.preventDefault(); return true;
}
function applyHandleDrag(worldDelta, mods = {}) {
  const { H, startNode, box } = hDrag; hDrag.uniform = !!mods.shift;
  if (startNode.virtual) {
    let out, v;
    if (H.kind === 'lift') { const dz = snapV(worldDelta.z); v = { ...startNode, pos: [0, 0, dz] }; out = C.applyVirtual(hDrag.starts, v); }
    else ({ nodes: out, virtual: v } = C.resizeMany(hDrag.starts, H.h, worldDelta.toArray(), { uniform: !!mods.shift, centre: !!mods.alt, snap }, box));
    hDrag.cur = v; out.forEach(x => { nodes[nodes.findIndex(y => y.id === x.id)] = x; const m = meshes.get(x.id); if (m) m.matrix.copy(C.nodeMatrix(x)); });
    updateHandles(); renderProps(true); updateRuler(); return;
  }
  const i = nodes.findIndex(x => x.id === hDrag.id); if (i < 0) return;
  if (H.kind === 'lift') { const n = structuredClone(startNode); n.pos[2] = Math.round((startNode.pos[2] + snapV(worldDelta.z)) * 1e4) / 1e4; nodes[i] = n; }
  else { const d = worldDelta.clone().applyQuaternion(C.nodeQuat(startNode).invert());
    nodes[i] = C.resizeNode(startNode, H.h, d.toArray(), { uniform: !!mods.shift, centre: !!mods.alt, snap, keepOnPlane: true }, box); }
  hDrag.cur = nodes[i];
  const m = meshes.get(hDrag.id); if (m) { m.matrix.copy(C.nodeMatrix(nodes[i])); }
  updateHandles(); renderProps(true); updateRuler();
}
renderer.domElement.addEventListener('pointermove', e => { if (!hDrag) return; setNdc(e);
  if (rDrag) { const p = ray.ray.intersectPlane(rDrag.plane, new THREE.Vector3()); if (p) applyRotate(p, { shift: e.shiftKey, alt: e.altKey }); return; } const p = ray.ray.intersectPlane(hDrag.plane, new THREE.Vector3()); if (!p) return;
  applyHandleDrag(p.sub(hDrag.start), { shift: e.shiftKey, alt: e.altKey }); });
addEventListener('pointerup', () => { if (!hDrag) return; if (rDrag) { rDrag.H.pick[0].material = rDrag.H.pick[1].material; rDrag = null; angleLabel.style.display = 'none'; } else hDrag.H.mesh.material = hMat[hDrag.H.kind]; hDrag = null; orbit.enabled = true; rebuild(); });

// ---------- custom workplane (W) and ruler (R) ----------
let pickMode = null, ruler = null; // ruler: { frame: Matrix4 }
function startPick(kind) { pickMode = kind; renderer.domElement.style.cursor = 'crosshair'; status(kind === 'workplane' ? 'Workplane: click a surface to place it, or click the empty grid to reset (Esc cancels)' : 'Ruler: click the workplane to place the ruler origin (Esc cancels)'); }
function endPick() { pickMode = null; renderer.domElement.style.cursor = ''; updateRuler(); }
function onPickClick(e) {
  setNdc(e); const kind = pickMode; endPick();
  if (kind === 'workplane') {
    const hit = ray.intersectObjects([...meshes.values()].filter(m => m.visible), false)[0];
    if (!hit) { setWorkplane(new THREE.Matrix4()); return status('Workplane reset to the default grid'); }
    const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); setWorkplane(C.frameFromSurface(hit.point.toArray(), nrm.toArray())); return status('Workplane placed on surface (W, then click empty space to reset)');
  }
  const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3()); if (!p) return; const l = toWP(p);
  placeRuler(fromWP(new THREE.Vector3(snapV(l.x), snapV(l.y), 0)));
}
const rulerObj = new THREE.Group(); rulerObj.visible = false; rulerObj.matrixAutoUpdate = false; scene.add(rulerObj);
{ const mat = new THREE.LineBasicMaterial({ color: '#1b2430', depthTest: false }); const pts = [];
  for (const ax of [0, 1]) { const e = [0, 0, 0]; e[ax] = 100; pts.push(0, 0, 0, ...e); for (let t = 10; t <= 100; t += 10) { const a = [0, 0, 0]; a[ax] = t; const b = a.slice(); b[1 - ax] = t % 50 ? -2 : -4; pts.push(...a, ...b); } }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const l = new THREE.LineSegments(g, mat); l.renderOrder = 12; rulerObj.add(l);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: '#1e6fd9', depthTest: false })); dot.renderOrder = 12; rulerObj.add(dot); }
const rLabels = ['x', 'y', 'z'].map((axis, i) => { const el = document.createElement('div'); el.className = 'dimlabel ruler'; el.style.pointerEvents = 'auto'; el.style.display = 'none'; labelLayer.appendChild(el);
  el.addEventListener('pointerdown', e => e.stopPropagation()); el.addEventListener('click', () => editRulerLabel(i, el)); return el; });
function placeRuler(at) { ruler = { frame: new THREE.Matrix4().extractRotation(wp).setPosition(at) }; rulerObj.matrix.copy(ruler.frame); rulerObj.matrixWorldNeedsUpdate = true; rulerObj.visible = true; status('Ruler placed – distances from the ruler are shown for the selection (click a value to type it). R removes it.'); }
function toggleRuler() { if (ruler) { ruler = null; rulerObj.visible = false; rLabels.forEach(l => (l.style.display = 'none')); status('Ruler removed'); } else startPick('ruler'); }
function rulerBox() { const s = selected(); return s.length && ruler ? C.boxInFrame(s, ruler.frame) : null; }
let rulerBoxCache = null, rulerKey = '';
function updateRulerLabels() {
  if (!ruler) return; const s = selected(); const key = JSON.stringify(s.map(n => [n.id, n.pos, n.rot, n.scale, C.geoKey(n)]));
  if (key !== rulerKey) { rulerKey = key; rulerBoxCache = rulerBox(); } const b = rulerBoxCache;
  rLabels.forEach((el, i) => {
    if (!b || el.querySelector('input')) { if (!b) el.style.display = 'none'; return; }
    const v = b.min.getComponent(i); const p = [0, 0, 0]; if (i === 2) { p[0] = b.min.x; p[1] = b.min.y; p[2] = v / 2; } else { p[i] = v / 2; p[1 - i] = -8; }
    const [x, y, z] = toScreen(new THREE.Vector3(...p).applyMatrix4(ruler.frame));
    el.style.display = z < 1 && (i < 2 || Math.abs(v) > 1e-3) ? 'block' : 'none'; el.style.left = x + 'px'; el.style.top = y + 'px'; el.textContent = 'XYZ'[i] + ' ' + (+v.toFixed(2)) + ' mm';
  });
}
function editRulerLabel(i, el) {
  const b = rulerBox(); if (!b) return; const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.value = +b.min.getComponent(i).toFixed(3); el.textContent = ''; el.appendChild(inp); inp.focus(); inp.select();
  const done = ok => { if (!inp.isConnected) return; const v = parseFloat(inp.value); inp.remove(); rulerKey = '';
    if (ok && isFinite(v)) { commit(); const d = new THREE.Vector3().setComponent(i, v - b.min.getComponent(i)).transformDirection(ruler.frame).multiplyScalar(Math.abs(v - b.min.getComponent(i)));
      selected().forEach(n => (n.pos = n.pos.map((p, k) => Math.round((p + d.getComponent(k)) * 1e4) / 1e4))); rebuild(); } };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }); inp.addEventListener('blur', () => done(true));
}

// ---------- settings / clipboard (filled in later) ----------
let settings = {};
function applySettings(s) { settings = { ...settings, ...s }; setWorkplane(settings.workplane ? new THREE.Matrix4().fromArray(settings.workplane) : new THREE.Matrix4()); }
function copySel() {}
function paste() {}

// ---------- files ----------
const native = window.native || { save: async o => { const b = new Blob([o.data]); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = o.name; a.click(); return o.name; },
  saveTo: async o => o.filePath, open: async () => null, confirm: async m => confirm(m), setState() {}, closeNow() {}, onMenu() {}, onOpenData() {} };
const baseName = p => (p ? p.split(/[\\/]/).pop() : 'Untitled');
function setDirty(d) { dirty = d; const t = `${baseName(filePath)}${dirty ? ' •' : ''} — LocalCAD`; document.title = t; native.setState({ dirty, title: t, filePath }); }
const projectText = () => C.serialize(nodes, { pos: camera.position.toArray(), target: orbit.target.toArray() }, settings);
async function saveAs() { const p = await native.save({ data: projectText(), kind: 'json', name: filePath ? baseName(filePath) : 'design.lcad' }); if (p) { filePath = p; setDirty(false); status('Saved ' + p); } return !!p; }
async function save() { if (!filePath) return saveAs(); await native.saveTo({ data: projectText(), filePath }); setDirty(false); status('Saved ' + filePath); return true; }
async function okToDiscard() { return !dirty || !nodes.length || native.confirm('Discard unsaved changes to ' + baseName(filePath) + '?'); }
function loadProject(f) { try { const d = C.deserialize(new TextDecoder().decode(f.data)); resetHistory(); nodes = d.nodes; sel = []; if (d.settings) applySettings(d.settings);
  if (d.camera) { camera.position.fromArray(d.camera.pos); orbit.target.fromArray(d.camera.target); } filePath = f.path || null; setDirty(false); rebuild(); status('Opened ' + f.name); } catch (e) { alert('Could not open: ' + e.message); } }
async function open() { if (!(await okToDiscard())) return; const f = await native.open(['json']); if (f) loadProject(f); }
native.onOpenData(async f => { if (await okToDiscard()) loadProject(f); });
async function importMesh() { const f = await native.open(['stl', 'obj']); if (!f) return; const u8 = new Uint8Array(f.data);
  const pos = /\.obj$/i.test(f.name) ? C.parseOBJ(new TextDecoder().decode(u8)) : C.parseSTL(u8); if (!pos.length) return alert('No triangles found');
  commit(); const n = C.meshNodeFromPositions(f.name.replace(/\.\w+$/, ''), pos); nodes.push(n); sel = [n.id]; rebuild(); fit(); }
async function exportFile(kind) { const s = selected().length ? selected() : nodes; if (!s.filter(n => !n.hole).length) return alert('Nothing solid to export');
  const p = kind === 'stl' ? await native.save({ data: C.syncCSG(() => C.toSTL(s)), kind: 'stl', name: 'design.stl', binary: true }) : await native.save({ data: C.syncCSG(() => C.toOBJ(s)), kind: 'obj', name: 'design.obj' }); if (p) status('Exported ' + p); }
async function newDoc() { if (!(await okToDiscard())) return; resetHistory(); nodes = []; sel = []; filePath = null; setDirty(false); rebuild(); home(); }
function inField() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); }
function toggleLock() { if (!sel.length) return; commit(); const l = !selected().every(n => n.locked); selected().forEach(n => (n.locked = l)); rebuild(); }
function selectAll() { if (inField()) return document.execCommand('selectAll'); sel = nodes.filter(n => !n.hidden).map(n => n.id); rebuild(); }
const actions = { workplane: () => startPick('workplane'), ruler: () => toggleRuler(), new: newDoc, open, save, saveas: saveAs, 'save-and-close': async () => { if (await save()) native.closeNow(); }, lock: toggleLock, hide, showall: showAll, selectall: selectAll,
  copy: () => (inField() ? document.execCommand('copy') : copySel()), cut: () => (inField() ? document.execCommand('cut') : (copySel(), del())), paste: () => (inField() ? document.execCommand('paste') : paste()),
  import: importMesh, exportstl: () => exportFile('stl'), exportobj: () => exportFile('obj'), undo, redo, duplicate, delete: del, group, ungroup };
native.onMenu(c => actions[c] && actions[c]());
document.querySelectorAll('#toolbar [data-a]').forEach(b => (b.onclick = () => actions[b.dataset.a]()));
document.querySelectorAll('#toolbar [data-m]').forEach(b => (b.onclick = () => setMode(b.dataset.m)));
document.querySelectorAll('#toolbar [data-al]').forEach(b => (b.onclick = () => align(b.dataset.al, 'mid')));
function setMode(m) { mode = m; if (m !== 'handles') tc.setMode(m); attachGizmo(); document.querySelectorAll('#toolbar [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m)); }
$('#snap').onchange = e => { snap = +e.target.value; tc.setTranslationSnap(snap || null); tc.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null); tc.setScaleSnap(snap ? 0.05 : null); updateRuler(); };
tc.setTranslationSnap(1); tc.setRotationSnap(THREE.MathUtils.degToRad(15)); tc.space = 'local';

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), step = e.shiftKey ? 10 : (snap || 1);
  if (mod && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); nudge(2, k === 'arrowup' ? step : -step); }
  else if (mod) return;
  else if (k === 'delete' || k === 'backspace') del();
  else if (k === 'arrowleft') nudge(0, -step); else if (k === 'arrowright') nudge(0, step);
  else if (k === 'arrowup') nudge(1, step); else if (k === 'arrowdown') nudge(1, -step);
  else if (k === 'h') setHole(true); else if (k === 's') setHole(false);
  else if (k === 'd') drop(); else if (k === 'f') fit(); else if (k === 'escape') { if (pickMode) endPick(); else { sel = []; rebuild(); } }
  else if (k === 'q') setMode('handles'); else if (k === 't') setMode('translate'); else if (k === 'e') setMode('rotate'); else if (k === 'w') startPick('workplane'); else if (k === 'r') toggleRuler();
  else if (k === 'm') mirror(0); else if (k === 'l') align('x', 'mid');
});
setDirty(false); rebuild(); home();

// ---------- smoke test hook (used by `npm run smoke`) ----------
window.__smoke = async () => { try {
  const dirtyStart = dirty;
  addShape('box', false, new THREE.Vector3(0, 0, 0)); addShape('cylinder', true, new THREE.Vector3(10, 0, 0));
  sel = nodes.map(n => n.id); group(); const g = nodes[0]; const wasAsync = C.localGeometry(g).userData.placeholder === true && computing.style.display === 'block';
  await whenCsgIdle(); const fromWorker = !C.localGeometry(g).userData.placeholder; const v = Math.abs(C.signedVolume(C.worldGeometry(g)));
  duplicate(); undo(); const selRestored = sel.length === 1 && sel[0] === g.id; ungroup(); const n = nodes.length; undo();
  const stl = C.syncCSG(() => C.toSTL(nodes)); renderer.render(scene, camera);
  // handle drag via real pointer events: drag the +X side handle of the selected group by ~+10mm
  sel = [nodes[0].id]; setMode('handles'); rebuild(); fly(new THREE.Vector3(0, 0, 1), 250); orbit.target.set(0, 0, 0); orbit.update(); tickHandles(); updateRulerLabels(); renderer.render(scene, camera);
  const w0 = C.localSize(nodes[0])[0]; const Hx = HANDLES[4]; const r = renderer.domElement.getBoundingClientRect();
  const [sx, sy] = toScreen(Hx.mesh.position); const [tx, ty] = toScreen(Hx.mesh.position.clone().add(new THREE.Vector3(10, 0, 0)));
  const ev = (t, x, y, tgt) => (tgt || renderer.domElement).dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, button: 0, bubbles: true }));
  ev('pointerdown', sx, sy); const grabbed = !!hDrag; ev('pointermove', tx, ty); ev('pointerup', tx, ty, window);
  const w1 = C.localSize(nodes[0])[0]; const labelsShown = LABELS.filter(L => L.el.style.display === 'block').length;
  const afterUndoCount = nodes.length;
  // custom workplane: click the top face of a box, add a shape -> it sits on top (z = 20)
  resetHistory(); nodes = [C.makeNode('box')]; sel = []; rebuild(); renderer.render(scene, camera);
  const [wx, wy] = toScreen(new THREE.Vector3(0, 0, 20)); startPick('workplane'); ev('pointerdown', wx, wy); ev('pointerup', wx, wy, window);
  addShape('cylinder', false, fromWP(new THREE.Vector3(0, 0, 0))); const wpZ = C.bbox([nodes[1]]).min.z;
  startPick('workplane'); const [ex, ey] = toScreen(new THREE.Vector3(150, 150, 0)); ev('pointerdown', ex, ey); ev('pointerup', ex, ey, window); const wpReset = isDefaultWP();
  // ruler at origin, select the box moved to x=30 -> ruler X distance = 20
  nodes[0].pos = [30, 0, 0]; sel = [nodes[0].id]; rebuild(); placeRuler(new THREE.Vector3(0, 0, 0)); rulerKey = ''; updateRulerLabels(); const rulerText = rLabels[0].textContent; toggleRuler();
  const wpOk = Math.abs(wpZ - 20) < 1e-3 && wpReset && rulerText === 'X 20 mm';
  // rotation arrow drag (Z): sweep ~30° around the centre -> snaps to 22.5°
  resetHistory(); nodes = [C.makeNode('box')]; sel = [nodes[0].id]; rebuild(); tickHandles(); renderer.render(scene, camera);
  const RZ = HANDLES.find(x => x.kind === 'rot' && x.axis === 2); const rg = rotGeom(RZ, C.nodeQuat(nodes[0]), C.handlePoint(nodes[0], [0, 0, 0], C.localBox(nodes[0])), C.localSize(nodes[0]));
  const at = a => rg.c.clone().add(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(rg.r));
  const a0 = THREE.MathUtils.degToRad(225); const [r0x, r0y] = toScreen(at(a0)); const [r1x, r1y] = toScreen(at(a0 + THREE.MathUtils.degToRad(30)));
  ev('pointerdown', r0x, r0y); const rGrab = !!rDrag; ev('pointermove', r1x, r1y); ev('pointerup', r1x, r1y, window);
  const rotZ = nodes[0].rot[2]; const rotOk = rGrab && Math.abs(rotZ - 22.5) < 0.01;
  // multi-selection handle drag: two boxes, drag combined +X side by 10mm => combined width +10
  resetHistory(); nodes = [C.makeNode('box'), C.makeNode('box')]; nodes[1].pos = [30, 0, 0]; sel = nodes.map(x => x.id); rebuild(); tickHandles(); renderer.render(scene, camera);
  const mw0 = C.bbox(nodes).getSize(new THREE.Vector3()).x; const [ax, ay] = toScreen(Hx.mesh.position); const [bx, by] = toScreen(Hx.mesh.position.clone().add(new THREE.Vector3(10, 0, 0)));
  ev('pointerdown', ax, ay); const mGrab = !!hDrag; ev('pointermove', bx, by); ev('pointerup', bx, by, window);
  const mw1 = C.bbox(nodes).getSize(new THREE.Vector3()).x; const multiOk = mGrab && Math.abs(mw1 - mw0 - 10) < 1.01;
  const dirtyTitle = document.title.includes('•'); filePath = '/tmp/localcad-smoke.lcad'; await save(); const savedTitle = document.title;
  const px = renderer.domElement.toDataURL().length;
  return { ok: wpOk && rotOk && multiOk && wasAsync && fromWorker && !dirtyStart && dirtyTitle && savedTitle === 'localcad-smoke.lcad — LocalCAD' && selRestored && afterUndoCount === 1 && n === 2 && v > 0 && v < 8000 && stl.length > 84 && px > 1000 && grabbed && Math.abs(w1 - w0 - 10) < 1.01 && labelsShown >= 3, grabbed, w0, w1, labelsShown, wpOk, wpZ, wpReset, rulerText, rotOk, rotZ, multiOk, mw0, mw1, selRestored, wasAsync, fromWorker, dirtyTitle, savedTitle, volume: v, nodesAfterUngroup: n, stlBytes: stl.length, canvasDataUrlLen: px };
} catch (e) { return { ok: false, error: String(e.stack || e) }; } };
// deterministic scene for screenshots: one rotated box with handles, fixed camera
window.__shotScene = () => { nodes = [C.makeNode('box')]; nodes[0].rot = [0, 0, 30]; sel = [nodes[0].id]; setMode('handles'); rebuild(); home(); orbit.update(); tickHandles(); updateRulerLabels(); renderer.render(scene, camera); return true; };
