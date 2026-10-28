# LocalCAD — offline Tinkercad-style 3D modeller for macOS

Original, MIT-licensed desktop app (Electron + three.js + three-bvh-csg). Runs 100% offline; no account, no cloud.
Not affiliated with Autodesk/Tinkercad; no Tinkercad code, assets or branding are used — only its publicly documented workflow was used as a UX reference.

## Install the prebuilt app (unsigned)
1. Pick the zip: Apple Silicon (M1–M4) → `LocalCAD-1.0.0-arm64-mac.zip`; Intel → `LocalCAD-1.0.0-mac.zip`.
2. Unzip, drag **LocalCAD.app** to `/Applications`.
3. Because the app is not signed/notarised, Gatekeeper will block it. In Terminal run:
   ```bash
   xattr -cr /Applications/LocalCAD.app
   codesign --force --deep --sign - /Applications/LocalCAD.app   # ad-hoc sign (needed on Apple Silicon)
   open /Applications/LocalCAD.app
   ```
   Or: right-click the app → **Open** → **Open**, or System Settings → Privacy & Security → **Open Anyway**.
   If macOS says the app "is damaged", the two commands above fix it.

## Run / build from source (on your Mac)
Requires Node.js 20+ (`brew install node`).
```bash
npm install
npm start            # run the app
npm test             # CSG / geometry / STL / OBJ / project unit tests
npm run dist         # build dist/*.zip for x64 + arm64
npm run dist:dmg     # build .dmg installers (dmg must be built on macOS)
```
Building on the Mac itself also ad-hoc signs the app automatically.

## Using it
- **Shapes panel** (left): Box, Cylinder, Sphere, Cone, Torus, Wedge, Pyramid, Tube, Half Sphere, Text, Box Hole, Cylinder Hole. Click to add, or drag onto the workplane.
- **Workplane**: 200×200 mm grid (1 mm minor / 10 mm major), Z up, units mm. Snap grid selector in toolbar (off/0.5/1/5/10 mm).
- **Select**: left-click; Shift+click multi-select; Ctrl/⌘+A all; Esc clear. Left-drag a shape to slide it on the workplane.
- **Camera**: right-drag orbit, middle-drag pan, wheel zoom; view cube (click faces/edges/corners), Home, Fit (F).
- **Resize handles (default, Q)**: selecting a shape shows Tinkercad-style handles on its bounding box (local axes, so they follow rotation; works on groups too):
  white corners resize X+Y with the opposite corner anchored, black side handles resize one axis, the white top handle sets height, and the blue cone above lifts the shape off the workplane.
  Hold **Shift** for uniform scaling and **Alt/Option** to resize from the centre; sizes snap to the grid setting. Live mm labels appear on the box. Click a label to type an exact value (Enter to apply, Esc to cancel).
  Drag the shape body to move it on the plane.
- **Gizmo**: Move (W) / Rotate (E) / Scale (R) buttons switch to arrow/ring gizmos; Q returns to resize handles.
- **Shape inspector** (right): Solid/Hole, colour, numeric position, size (W/D/H mm), rotation, shape parameters (radius, sides, text…), align, mirror, lock, hide.
- **Group** combines selected shapes with real CSG: solids are unioned, holes subtracted. Ungroup restores the parts.
- **Files**: Save/Open projects as `.lcad` (JSON). Import STL (binary/ASCII) and OBJ. Export STL/OBJ of selection, or the whole scene if nothing is selected (holes are never exported).

### Keyboard shortcuts
| Key | Action |
|---|---|
| ⌘/Ctrl+D | Duplicate (press again after moving the copy to repeat the same move/rotate — "duplicate and repeat") |
| ⌘/Ctrl+G / ⌘/Ctrl+Shift+G | Group / Ungroup |
| ⌘/Ctrl+Z / ⌘/Ctrl+Shift+Z (or Ctrl+Y) | Undo / Redo |
| H / S | Make hole / make solid |
| D | Drop selection onto the workplane |
| M | Mirror along X (Y/Z in inspector) |
| L | Align centres on X (all align options in inspector) |
| Arrows | Nudge 1 snap step in X/Y (Shift = 10 mm) |
| ⌘/Ctrl+↑/↓ | Raise / lower |
| ⌘/Ctrl+L | Lock / unlock |
| ⌘/Ctrl+Shift+H, ⌘/Ctrl+Shift+A | Hide, show all |
| Delete/Backspace | Delete |
| F | Fit view |
| ⌘/Ctrl+S, ⌘/Ctrl+O, ⌘/Ctrl+I, ⌘/Ctrl+E | Save, Open, Import, Export STL |

## Project layout
`main.js` (window, menus, file dialogs) · `preload.js` · `src/core.js` (shapes, CSG, STL/OBJ, project format — DOM-free, unit tested) · `src/app.js` (UI) · `test/` · `build.mjs` (esbuild bundle).

Fonts: Helvetiker typeface JSON from the three.js examples (MIT / font licence in three.js repo).

## Project layout

- `src/core.js` – geometry, CSG, node model, import/export, serialisation (pure, tested in `test/core.test.mjs`).
- `src/ui/` – UI-side modules: `history.js` (undo/redo with selection), `duplicate.js` (duplicate & repeat), `importer.js` (STL/OBJ import), `keymap.js` (single-key shortcuts), `grid.js`, `csg-client.js` (Web Worker CSG). Tested in `test/ui.test.mjs`.
- `src/app.js` – viewport, handles, ruler/workplane, inspector and wiring.
- `src/csg-worker.js` – runs group booleans off the UI thread.
- `npm test` runs unit tests, `npm run smoke` runs a deterministic end-to-end check in Electron (fixed 1280×800 viewport, cleared settings).

## Releases

Pushing a tag `v*` runs `.github/workflows/release.yml` on a macOS runner, which builds unsigned arm64 and x64 `.dmg` and `.zip` files and attaches them to a GitHub Release. The app is unsigned, so on first launch right-click → Open (or `xattr -dr com.apple.quarantine /Applications/LocalCAD.app`).

## Shortcuts

Q resize handles · T move gizmo · E rotate gizmo · W workplane · R ruler · H hole · S solid · D drop · F fit · M mirror · L align · arrows nudge · ⌘C/⌘X/⌘V · ⌘D duplicate & repeat · ⌘G / ⇧⌘G group/ungroup · ⌘, workplane settings.
