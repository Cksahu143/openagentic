// Intelligent Cache — memoize perception snapshots and derived selectors,
// invalidate on DOM mutation. Content-script scope.

let currentSnap = null;
let currentSig = 0;
let mutationTick = 0;

const selectorCache = new Map(); // name -> { ref, tick }
const MAX_SEL = 200;

export function bumpMutation() { mutationTick++; }
export function mutationCounter() { return mutationTick; }

export function putSnapshot(snap) {
  currentSnap = snap;
  currentSig = mutationTick;
}
export function getFreshSnapshot() {
  return currentSnap && currentSig === mutationTick ? currentSnap : null;
}

export function rememberSelector(name, ref) {
  if (!name || !ref) return;
  if (selectorCache.size >= MAX_SEL) {
    const first = selectorCache.keys().next().value;
    selectorCache.delete(first);
  }
  selectorCache.set(name.toLowerCase(), { ref, tick: mutationTick });
}
export function resolveSelector(name) {
  const hit = selectorCache.get((name || "").toLowerCase());
  if (!hit) return null;
  if (hit.tick !== mutationTick) { selectorCache.delete(name.toLowerCase()); return null; }
  return hit.ref;
}

export function clearCache() {
  currentSnap = null;
  currentSig = 0;
  selectorCache.clear();
}
