import * as C from '../core.js';
/**
 * Offload group CSG to a Web Worker. While a key is pending, core returns a placeholder geometry;
 * when the worker answers the result is cached and onResult() is called (the app rebuilds).
 */
export function startCsgWorker({ url, indicator, onResult, onError }) {
  const pending = new Set(); let waiters = []; let worker = null;
  try { worker = new Worker(url); } catch (e) { console.warn('CSG worker unavailable, computing on main thread', e); }
  if (worker) {
    C.csgHooks.async = (n, key) => { if (pending.has(key)) return; pending.add(key); indicator.style.display = 'block'; worker.postMessage({ key, node: n }); };
    worker.onmessage = ({ data }) => {
      pending.delete(data.key);
      if (data.error) onError(data.error); else C.cachePut(data.key, C.geometryFromArrays(data.pos, data.nrm, data.col));
      if (!pending.size) { indicator.style.display = 'none'; waiters.forEach(f => f()); waiters = []; }
      onResult();
    };
  }
  return { whenIdle: () => (pending.size ? new Promise(r => waiters.push(r)) : Promise.resolve()), get busy() { return pending.size > 0; } };
}
