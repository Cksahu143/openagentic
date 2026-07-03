// Adaptive waits — replace fixed setTimeout sleeps with event-driven waits
// that fall back to a small timeout only when no event is available.

/** Wait for the next animation frame — cheapest possible yield. */
export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r(null)));
}

/** Wait until predicate() returns truthy or timeout expires. Yields on rAF. */
export async function waitUntil(predicate, { timeout = 2500, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  // Fast path
  const r0 = predicate();
  if (r0) return r0;
  // rAF-driven loop, poll fallback if the tab is background-throttled
  while (Date.now() < deadline) {
    await new Promise((res) => {
      const raf = requestAnimationFrame(() => res(null));
      setTimeout(() => { cancelAnimationFrame(raf); res(null); }, interval);
    });
    const r = predicate();
    if (r) return r;
  }
  return null;
}

/**
 * Wait for the DOM to become "stable" — no meaningful mutations for `quietMs`.
 * Falls back to a hard timeout so we never hang.
 */
export function waitForDomIdle({ quietMs = 250, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    let lastMut = Date.now();
    let done = false;
    const finish = (reason) => {
      if (done) return; done = true;
      mo.disconnect();
      clearInterval(iv);
      clearTimeout(to);
      resolve({ reason });
    };
    const mo = new MutationObserver(() => { lastMut = Date.now(); });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: false });
    const iv = setInterval(() => {
      if (Date.now() - lastMut >= quietMs && document.readyState !== "loading") finish("idle");
    }, Math.min(quietMs, 120));
    const to = setTimeout(() => finish("timeout"), timeout);
  });
}

/** Wait for a URL change or timeout. Uses history + hash events, no polling. */
export function waitForNavigation({ from = location.href, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (changed) => {
      if (done) return; done = true;
      window.removeEventListener("popstate", handler);
      window.removeEventListener("hashchange", handler);
      clearInterval(iv);
      clearTimeout(to);
      resolve({ changed, url: location.href });
    };
    const handler = () => { if (location.href !== from) finish(true); };
    window.addEventListener("popstate", handler);
    window.addEventListener("hashchange", handler);
    // Pushstate cannot be observed via event; poll cheaply.
    const iv = setInterval(handler, 100);
    const to = setTimeout(() => finish(location.href !== from), timeout);
  });
}
