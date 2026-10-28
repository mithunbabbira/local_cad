// Single-key shortcuts (modifier shortcuts come from the native menu). Returns an action id or null.
const KEYS = { delete: 'delete', backspace: 'delete', h: 'hole', s: 'solid', d: 'drop', f: 'fit', escape: 'escape', q: 'mode:handles', t: 'mode:translate',
  e: 'mode:rotate', w: 'workplane', r: 'ruler', m: 'mirror', l: 'align' };
const ARROWS = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [1, 1], arrowdown: [1, -1] };
export function keyAction({ key, metaKey, ctrlKey, shiftKey }, snap = 1) {
  const k = key.toLowerCase(), mod = metaKey || ctrlKey, step = shiftKey ? 10 : (snap || 1);
  if (mod && (k === 'arrowup' || k === 'arrowdown')) return { action: 'nudge', axis: 2, amount: k === 'arrowup' ? step : -step };
  if (mod) return null;
  if (ARROWS[k]) return { action: 'nudge', axis: ARROWS[k][0], amount: ARROWS[k][1] * step };
  return KEYS[k] ? { action: KEYS[k] } : null;
}
