// Undo/redo history of serialised snapshots ({nodes, sel}); undo restores the selection too.
export class History {
  constructor(limit = 200) { this.limit = limit; this.reset(); }
  reset() { this.undoStack = []; this.redoStack = []; }
  /** Record the state *before* a change. */
  push(snap) { this.undoStack.push(snap); if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack = []; }
  /** Returns the snapshot to restore, or null. `current` is the state being left. */
  undo(current) { if (!this.undoStack.length) return null; this.redoStack.push(current); return this.undoStack.pop(); }
  redo(current) { if (!this.redoStack.length) return null; this.undoStack.push(current); return this.redoStack.pop(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
