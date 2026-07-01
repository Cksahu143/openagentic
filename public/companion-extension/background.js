// OpenAgent Companion — background service worker (v0.3.0, Milestone 9 completion).
//
// - Polls Supabase every ~6s for pending commands (MV3 alarms floor).
// - Chains a fast follow-up poll after each command so multi-step agent loops
//   feel realtime (Observe → Think → Act).
// - Rich HYBRID observation: DOM structure + accessibility hints + page state,
//   returned as one unified object. Screenshots only when the agent asks.
// - Intelligent waiting: selector / text / visible / enabled / network-idle /
//   dom-stable / page-ready.
// - Injects a glowing "AI working" overlay into every controlled tab.

const POLL_ALARM = "openagent-poll";
const KEEPALIVE_ALARM = "openagent-keepalive";
const POLL_PERIOD_MIN = 0.1; // 6s

// ---------------- config / auth ----------------

async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return config || null;
}
async function setConfig(cfg) { await chrome.storage.local.set({ config: cfg }); }
async function clearConfig() { await chrome.storage.local.remove("config"); }

async function refreshAccessToken(cfg) {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.key },
    body: JSON.stringify({ refresh_token: cfg.refresh_token }),
  });
  if (!r.ok) throw new Error("refresh failed: " + r.status);
  const data = await r.json();
  cfg.access_token = data.access_token;
  cfg.refresh_token = data.refresh_token;
  cfg.expires_at = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  await setConfig(cfg);
  return cfg;
}

async function pgFetch(cfg, path, init = {}, retry = true) {
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.access_token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...(init.headers || {}),
  };
  const r = await fetch(`${cfg.url}/rest/v1${path}`, { ...init, headers });
  if (r.status === 401 && retry) {
    const fresh = await refreshAccessToken(cfg);
    return pgFetch(fresh, path, init, false);
  }
  return r;
}

// ---------------- Overlay ("AI working" glow) ----------------

const controlledTabs = new Set();

function overlayInject() {
  if (window.__openagentOverlay) return;
  const style = document.createElement("style");
  style.id = "openagent-overlay-style";
  style.textContent = `
  @keyframes openagent-pulse {
    0%,100% { box-shadow: inset 0 0 0 3px rgba(99,102,241,.9), inset 0 0 40px rgba(99,102,241,.4), 0 0 30px rgba(99,102,241,.5); }
    50%     { box-shadow: inset 0 0 0 3px rgba(139,92,246,.95), inset 0 0 60px rgba(139,92,246,.55), 0 0 45px rgba(139,92,246,.7); }
  }
  #openagent-overlay {
    position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
    animation: openagent-pulse 1.8s ease-in-out infinite;
    transition: opacity .4s ease;
  }
  #openagent-overlay .oa-badge {
    position: absolute; top: 12px; right: 12px;
    background: rgba(15,15,25,.85); color: #fff;
    font: 500 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
    padding: 8px 12px; border-radius: 999px;
    border: 1px solid rgba(139,92,246,.6);
    display: flex; gap: 8px; align-items: center;
    box-shadow: 0 4px 20px rgba(0,0,0,.4);
  }
  #openagent-overlay .oa-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #a78bfa; box-shadow: 0 0 8px #a78bfa;
    animation: openagent-pulse 1.2s ease-in-out infinite;
  }`;
  document.documentElement.appendChild(style);
  const el = document.createElement("div");
  el.id = "openagent-overlay";
  el.innerHTML = `<div class="oa-badge"><div class="oa-dot"></div>OpenAgent is working…</div>`;
  document.documentElement.appendChild(el);
  window.__openagentOverlay = true;
}

function overlayRemove() {
  const el = document.getElementById("openagent-overlay");
  const st = document.getElementById("openagent-overlay-style");
  if (el) { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }
  if (st) setTimeout(() => st.remove(), 400);
  window.__openagentOverlay = false;
}

async function showOverlay(tabId) {
  if (!tabId) return;
  controlledTabs.add(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: overlayInject });
  } catch { /* ignore (chrome:// pages, etc.) */ }
}
async function hideOverlay(tabId) {
  if (!tabId) return;
  controlledTabs.delete(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: overlayRemove });
  } catch { /* ignore */ }
}

// ---------------- Injected page helpers ----------------

// Hybrid observation: structured DOM + semantic landmarks + page state.
// Returns ONE unified observation object the agent reasons over.
function pageObserve(opts) {
  const { max = 120, includeText = true } = opts || {};
  const trim = (s, n = 160) => (s || "").toString().replace(/\s+/g, " ").trim().slice(0, n);

  // --- interactive elements with stable refs ---
  const SELECTABLE = "a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=combobox],[role=checkbox],[role=tab],[contenteditable=true]";
  const interactive = [];
  let idx = 0;
  for (const el of document.querySelectorAll(SELECTABLE)) {
    if (idx >= max) break;
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < (window.innerHeight + 400);
    if (!visible) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || tag;
    const label = trim(
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      el.value ||
      (includeText ? el.innerText : "") ||
      "",
      100,
    );
    const ref = `oa-${idx}`;
    el.setAttribute("data-oa-ref", ref);
    interactive.push({
      ref, tag, role, id: el.id || null,
      name: el.getAttribute("name") || null,
      type: el.getAttribute("type") || null,
      disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
      checked: el.checked ?? undefined,
      label,
      href: el.href || null,
      x: Math.round(rect.left), y: Math.round(rect.top),
      w: Math.round(rect.width), h: Math.round(rect.height),
    });
    idx++;
  }

  // --- headings (h1-h4, keep it small) ---
  const headings = [];
  for (const h of document.querySelectorAll("h1,h2,h3,h4")) {
    const t = trim(h.innerText, 140);
    if (t) headings.push({ level: Number(h.tagName[1]), text: t });
    if (headings.length >= 25) break;
  }

  // --- landmarks (nav / main / aside / header / footer + aria roles) ---
  const landmarks = [];
  for (const l of document.querySelectorAll(
    "nav,main,aside,header,footer,[role=navigation],[role=main],[role=banner],[role=contentinfo],[role=complementary],[role=search]",
  )) {
    landmarks.push({
      tag: l.tagName.toLowerCase(),
      role: l.getAttribute("role") || l.tagName.toLowerCase(),
      label: trim(l.getAttribute("aria-label") || l.getAttribute("aria-labelledby") || "", 80),
    });
    if (landmarks.length >= 20) break;
  }

  // --- forms ---
  const forms = [];
  for (const f of document.querySelectorAll("form")) {
    const fields = [];
    for (const el of f.querySelectorAll("input,textarea,select")) {
      fields.push({
        name: el.getAttribute("name") || null,
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
        label: trim(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "", 60),
        required: el.required || el.getAttribute("aria-required") === "true",
      });
      if (fields.length >= 20) break;
    }
    forms.push({
      action: f.getAttribute("action") || null,
      method: (f.getAttribute("method") || "get").toLowerCase(),
      name: f.getAttribute("name") || f.id || null,
      fields,
    });
    if (forms.length >= 10) break;
  }

  // --- tables (headers + first row samples) ---
  const tables = [];
  for (const t of document.querySelectorAll("table")) {
    const headers = Array.from(t.querySelectorAll("thead th, tr:first-child th"))
      .map((th) => trim(th.innerText, 60)).slice(0, 12);
    const rows = t.querySelectorAll("tbody tr, tr").length;
    tables.push({ headers, rows: Math.min(rows, 9999),
      caption: trim(t.querySelector("caption")?.innerText, 100) });
    if (tables.length >= 6) break;
  }

  // --- lists (short summary only) ---
  const lists = [];
  for (const l of document.querySelectorAll("ul,ol")) {
    const items = l.querySelectorAll("li").length;
    if (items >= 3 && items <= 200) {
      lists.push({ tag: l.tagName.toLowerCase(), items,
        firstItem: trim(l.querySelector("li")?.innerText, 80) });
    }
    if (lists.length >= 8) break;
  }

  // --- dialogs / modals ---
  const dialogs = [];
  for (const d of document.querySelectorAll(
    "dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]",
  )) {
    dialogs.push({
      role: d.getAttribute("role") || d.tagName.toLowerCase(),
      label: trim(d.getAttribute("aria-label") || d.getAttribute("aria-labelledby") || d.innerText, 200),
    });
    if (dialogs.length >= 5) break;
  }

  // --- error messages (aria-live, role=alert, .error/.error-message) ---
  const errors = [];
  for (const e of document.querySelectorAll(
    "[role=alert],[aria-live=assertive],[aria-live=polite],.error,.error-message,.form-error,[data-error]",
  )) {
    const t = trim(e.innerText, 200);
    if (t) errors.push({ role: e.getAttribute("role") || "alert", text: t });
    if (errors.length >= 8) break;
  }

  // --- loading indicators ---
  const loading = [];
  for (const s of document.querySelectorAll(
    "[role=progressbar],[aria-busy=true],.spinner,.loading,.loader,[data-loading=true]",
  )) {
    loading.push({
      role: s.getAttribute("role") || "spinner",
      label: trim(s.getAttribute("aria-label") || "", 60),
    });
    if (loading.length >= 5) break;
  }

  // --- images with alt text ---
  const images = [];
  for (const img of document.querySelectorAll("img[alt]")) {
    const alt = trim(img.getAttribute("alt"), 140);
    if (alt) images.push({ alt, src: (img.src || "").slice(0, 200) });
    if (images.length >= 12) break;
  }

  // --- meaningful paragraphs (visible, non-trivial length) ---
  const paragraphs = [];
  for (const p of document.querySelectorAll("p")) {
    const t = trim(p.innerText, 240);
    if (t.length > 40) paragraphs.push(t);
    if (paragraphs.length >= 8) break;
  }

  // --- meta description ---
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || null;

  // --- lightweight page state ---
  const pageState =
    document.querySelector("[role=alertdialog],dialog[open]") ? "dialog-open"
    : loading.length > 0 ? "loading"
    : errors.length > 0 ? "error"
    : document.readyState !== "complete" ? "loading"
    : "ready";

  // --- naive semantic summary ---
  const summary = [
    document.title,
    metaDesc ? `— ${trim(metaDesc, 140)}` : "",
    interactive.length ? `${interactive.length} controls` : "",
    forms.length ? `${forms.length} form${forms.length > 1 ? "s" : ""}` : "",
    tables.length ? `${tables.length} table${tables.length > 1 ? "s" : ""}` : "",
    errors.length ? `⚠ ${errors.length} error${errors.length > 1 ? "s" : ""}` : "",
    dialogs.length ? `dialog open` : "",
  ].filter(Boolean).join(" · ");

  return {
    url: location.href,
    title: document.title,
    metaDescription: metaDesc,
    readyState: document.readyState,
    pageState,
    summary,
    scroll: { y: window.scrollY, max: document.documentElement.scrollHeight },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    headings,
    landmarks,
    forms,
    tables,
    lists,
    dialogs,
    errors,
    loading,
    images,
    paragraphs,
    elements: interactive,
  };
}

function pageResolve(sel) {
  if (sel.ref) return document.querySelector(`[data-oa-ref="${sel.ref}"]`);
  if (sel.selector) return document.querySelector(sel.selector);
  const wanted = (sel.text || sel.label || "").toLowerCase();
  if (!wanted) return null;
  const cand = document.querySelectorAll(
    "a,button,input,textarea,select,[role=button],[role=link],[role=textbox]"
  );
  for (const el of cand) {
    const t = (el.innerText || el.value || el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") || el.getAttribute("name") || "").toLowerCase();
    if (t.includes(wanted)) return el;
  }
  return null;
}

async function pageClick(sel) {
  const el = pageResolve(sel);
  if (!el) return { ok: false, error: "element not found" };
  if (el.disabled || el.getAttribute("aria-disabled") === "true") {
    return { ok: false, error: "element disabled" };
  }
  const urlBefore = location.href;
  const htmlBefore = document.documentElement.outerHTML.length;

  // 1. Scroll into view and settle a frame.
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  // 2. Verify visible + not occluded.
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  if (rect.width === 0 || rect.height === 0 || cs.visibility === "hidden" || cs.display === "none") {
    return { ok: false, error: "element not visible after scroll" };
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const occluded = hit && hit !== el && !el.contains(hit) && !hit.contains(el);

  // 3. Try native click first.
  let method = "click";
  try { el.click(); } catch { /* ignore */ }

  // 4. If nothing changed AND we detected occlusion, retry with a synthesized
  //    pointer/mouse sequence at the rect center (bypasses transparent overlays
  //    that don't intercept synthesized events).
  const changed = () =>
    location.href !== urlBefore ||
    document.documentElement.outerHTML.length !== htmlBefore;
  await new Promise((r) => setTimeout(r, 60));
  if (occluded && !changed()) {
    method = "synthesized";
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  return {
    ok: true,
    tag: el.tagName.toLowerCase(),
    method,
    occluded: !!occluded,
    urlChanged: location.href !== urlBefore,
    urlAfter: location.href,
  };
}


function pageFill(sel, value, submit) {
  const el = pageResolve(sel);
  if (!el) return { ok: false, error: "element not found" };
  el.focus();
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (submit) {
    const form = el.form;
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  return { ok: true };
}

function pageSelect(sel, value) {
  const el = pageResolve(sel);
  if (!el) return { ok: false, error: "element not found" };
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

function pageScroll(args) {
  if (args.to === "top") window.scrollTo({ top: 0 });
  else if (args.to === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight });
  else window.scrollBy({ top: args.dy || 400 });
  return { ok: true, y: window.scrollY };
}

// Intelligent wait — supports many "for" modes.
async function pageWaitFor(sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  const mode = sel.mode || (sel.selector ? "selector" : sel.text ? "text" : "ready");

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const isEnabled = (el) => el && !el.disabled && el.getAttribute("aria-disabled") !== "true";

  const findByText = () => {
    const wanted = (sel.text || "").toLowerCase();
    return Array.from(document.querySelectorAll("body *"))
      .find(e => (e.innerText || "").toLowerCase().includes(wanted));
  };

  // dom-stable: mutation-observed quiet period
  if (mode === "dom-stable") {
    let quietUntil = Date.now() + (sel.quietMs || 500);
    const obs = new MutationObserver(() => { quietUntil = Date.now() + (sel.quietMs || 500); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    try {
      while (Date.now() < deadline) {
        if (Date.now() >= quietUntil) return { ok: true, mode };
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: false, error: "timeout waiting for dom-stable" };
    } finally { obs.disconnect(); }
  }

  while (Date.now() < deadline) {
    if (mode === "ready" && document.readyState === "complete") {
      return { ok: true, mode, url: location.href };
    }
    if (mode === "dialog") {
      const d = document.querySelector("dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]");
      if (d) return { ok: true, mode };
    }
    if (mode === "selector" || mode === "visible" || mode === "enabled") {
      const el = sel.selector ? document.querySelector(sel.selector) : (sel.text ? findByText() : null);
      if (el) {
        if (mode === "selector") return { ok: true, mode, url: location.href };
        if (mode === "visible" && isVisible(el)) return { ok: true, mode };
        if (mode === "enabled" && isEnabled(el) && isVisible(el)) return { ok: true, mode };
      }
    }
    if (mode === "text") {
      const el = findByText();
      if (el) return { ok: true, mode, url: location.href };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return { ok: false, error: "timeout", mode };
}

// ---------------- Handlers ----------------

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.map(t => ({
    id: t.id, windowId: t.windowId, url: t.url, title: t.title,
    active: t.active, status: t.status,
  })) };
}

async function openTab({ url, active = true }) {
  const tab = await chrome.tabs.create({ url, active });
  await showOverlay(tab.id);
  return { id: tab.id, tabId: tab.id, url: tab.url, windowId: tab.windowId };
}

async function closeTab({ tabId }) {
  await hideOverlay(tabId);
  await chrome.tabs.remove(tabId);
  return { closed: tabId };
}

async function activateTab({ tabId }) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { activated: tabId };
}

async function searchWeb({ query, engine = "google" }) {
  const q = encodeURIComponent(query);
  const urls = {
    google: `https://www.google.com/search?q=${q}`,
    duckduckgo: `https://duckduckgo.com/?q=${q}`,
    bing: `https://www.bing.com/search?q=${q}`,
  };
  const tab = await chrome.tabs.create({ url: urls[engine] || urls.google, active: true });
  await showOverlay(tab.id);
  return { id: tab.id, tabId: tab.id, url: tab.pendingUrl || tab.url };
}

async function getActiveTabId(explicitId) {
  if (explicitId) return explicitId;
  const [a] = await chrome.tabs.query({ active: true, currentWindow: true });
  return a?.id;
}

// Wait for both tabs.onUpdated=complete and a short network-idle window.
async function waitForNavigation(id, timeoutMs = 15000) {
  const start = Date.now();
  await new Promise((resolve) => {
    let done = false;
    const listener = (updatedId, info) => {
      if (updatedId === id && info.status === "complete" && !done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { if (!done) { chrome.tabs.onUpdated.removeListener(listener); resolve(); } },
      timeoutMs);
  });
  return { elapsedMs: Date.now() - start };
}

async function navigate({ tabId, url }) {
  const id = await getActiveTabId(tabId);
  await chrome.tabs.update(id, { url });
  await showOverlay(id);
  await waitForNavigation(id);
  const tab = await chrome.tabs.get(id).catch(() => null);
  return { ok: true, tabId: id, url: tab?.url || url };
}

async function readActiveTab() {
  const id = await getActiveTabId();
  if (!id) return { error: "no active tab" };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => ({
        url: location.href, title: document.title,
        text: (document.body?.innerText || "").slice(0, 8000),
      }),
    });
    return { ...(res?.result || {}), tabId: id };
  } catch (e) { return { error: String(e) }; }
}

async function readTab({ tabId }) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href, title: document.title,
        text: (document.body?.innerText || "").slice(0, 8000),
      }),
    });
    return { ...(res?.result || {}), tabId };
  } catch (e) { return { error: String(e) }; }
}

async function observe({ tabId, max, includeText }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id },
    func: pageObserve,
    args: [{ max, includeText }],
  });
  return { ...(res?.result || {}), tabId: id };
}

async function clickEl({ tabId, ref, selector, text }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageClick, args: [{ ref, selector, text }],
  });
  return { ...(res?.result || { ok: false }), tabId: id };
}

async function fillEl({ tabId, ref, selector, label, value, submit }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageFill,
    args: [{ ref, selector, label }, value, !!submit],
  });
  return { ...(res?.result || { ok: false }), tabId: id };
}

async function selectEl({ tabId, ref, selector, value }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageSelect, args: [{ ref, selector }, value],
  });
  return { ...(res?.result || { ok: false }), tabId: id };
}

async function scrollPage({ tabId, to, dy }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageScroll, args: [{ to, dy }],
  });
  return { ...(res?.result || { ok: false }), tabId: id };
}

async function waitFor({ tabId, mode, selector, text, timeoutMs, quietMs }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageWaitFor, args: [{ mode, selector, text, quietMs }, timeoutMs],
  });
  return { ...(res?.result || { ok: false }), tabId: id };
}

async function releaseTab({ tabId }) {
  const id = await getActiveTabId(tabId);
  await hideOverlay(id);
  return { ok: true };
}

// Screenshot fallback — visible viewport of the active tab's window.
async function screenshot({ tabId, quality = 60 }) {
  const id = await getActiveTabId(tabId);
  const tab = await chrome.tabs.get(id);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg", quality,
    });
    return { ok: true, tabId: id, dataUrl, url: tab.url, title: tab.title, capturedAt: Date.now() };
  } catch (e) {
    return { ok: false, tabId: id, error: String(e?.message || e) };
  }
}

const HANDLERS = {
  list_tabs: listTabs,
  open_tab: openTab,
  close_tab: closeTab,
  activate_tab: activateTab,
  search_web: searchWeb,
  read_active_tab: readActiveTab,
  read_tab: readTab,
  navigate,
  observe,
  get_dom: observe, // back-compat alias — old servers still call get_dom
  click: clickEl,
  fill: fillEl,
  select: selectEl,
  scroll: scrollPage,
  wait_for: waitFor,
  release_tab: releaseTab,
  screenshot,
  ping: async () => ({ pong: true, at: Date.now() }),
};

// ---------------- Command loop ----------------

async function handleCommand(cfg, cmd) {
  await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "running" }),
  });
  try {
    const fn = HANDLERS[cmd.action];
    if (!fn) throw new Error("Unknown action: " + cmd.action);
    const result = await fn(cmd.args || {});
    await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result }),
    });
  } catch (e) {
    await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "error", error: String(e?.message || e) }),
    });
  }
}

let polling = false;
async function poll(chain = true) {
  if (polling) return;
  polling = true;
  try {
    const cfg = await getConfig();
    if (!cfg) return;
    const path = `/companion_commands?status=eq.pending&or=(device_id.eq.${cfg.device_id},device_id.is.null)&order=created_at.asc&limit=5`;
    const r = await pgFetch(cfg, path);
    if (!r.ok) return;
    const cmds = await r.json();
    await pgFetch(cfg, `/companion_devices?id=eq.${cfg.device_id}`, {
      method: "PATCH", body: JSON.stringify({ last_seen: new Date().toISOString() }),
    });
    if (cmds.length === 0) {
      for (const id of Array.from(controlledTabs)) await hideOverlay(id);
      return;
    }
    for (const c of cmds) {
      if (!c.device_id) {
        await pgFetch(cfg, `/companion_commands?id=eq.${c.id}`, {
          method: "PATCH", body: JSON.stringify({ device_id: cfg.device_id }),
        });
      }
      await handleCommand(cfg, c);
    }
    if (chain) setTimeout(() => poll(false), 300);
  } catch (e) {
    console.warn("[companion] poll", e);
  } finally {
    polling = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) poll();
});
chrome.tabs.onRemoved.addListener((tabId) => controlledTabs.delete(tabId));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "pair") {
      try {
        const cfg = JSON.parse(atob(msg.code));
        await setConfig(cfg);
        chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
        await poll();
        sendResponse({ ok: true, device_id: cfg.device_id, user_id: cfg.user_id });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    } else if (msg?.type === "status") {
      const cfg = await getConfig();
      sendResponse({ paired: !!cfg, device_id: cfg?.device_id, user_id: cfg?.user_id });
    } else if (msg?.type === "unpair") {
      await clearConfig();
      sendResponse({ ok: true });
    }
  })();
  return true;
});
