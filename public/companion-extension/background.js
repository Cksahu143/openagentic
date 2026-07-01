// OpenAgent Companion — background service worker.
//
// - Polls Supabase every ~6s for pending commands (MV3 alarms floor).
// - Chains a fast follow-up poll after each command so multi-step agent loops
//   feel realtime (Observe → Think → Act).
// - Rich handlers: navigate, click, fill, wait_for, select, scroll, press_key,
//   get_dom (structured), get_state, plus tab management.
// - Injects a glowing "AI working" overlay into every controlled tab and
//   removes it when the agent is idle.

const POLL_ALARM = "openagent-poll";
const KEEPALIVE_ALARM = "openagent-keepalive";
const POLL_PERIOD_MIN = 0.1; // 6s — MV3 minimum in production may be 30s

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
// These run *inside the page* via chrome.scripting.executeScript.

function pageGetDom(opts) {
  const { max = 120, includeText = true } = opts || {};
  const SELECTABLE = "a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=combobox],[role=checkbox],[role=tab],[contenteditable=true]";
  const nodes = Array.from(document.querySelectorAll(SELECTABLE));
  const items = [];
  let idx = 0;
  for (const el of nodes) {
    if (idx >= max) break;
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < (window.innerHeight + 400);
    if (!visible) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || tag;
    const label = (el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      el.value ||
      (includeText ? (el.innerText || "").trim().slice(0, 80) : "") ||
      "").trim();
    const id = el.id || null;
    const ref = `oa-${idx}`;
    el.setAttribute("data-oa-ref", ref);
    items.push({
      ref, tag, role, id,
      name: el.getAttribute("name") || null,
      type: el.getAttribute("type") || null,
      label,
      href: el.href || null,
      x: Math.round(rect.left), y: Math.round(rect.top),
      w: Math.round(rect.width), h: Math.round(rect.height),
    });
    idx++;
  }
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    scroll: { y: window.scrollY, max: document.documentElement.scrollHeight },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    elements: items,
  };
}

function pageResolve(sel) {
  // sel may be: { ref: "oa-3" } | { selector: "css" } | { text: "..." } | { label: "..." }
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

function pageClick(sel) {
  const el = pageResolve(sel);
  if (!el) return { ok: false, error: "element not found" };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase() };
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

async function pageWaitFor(sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  while (Date.now() < deadline) {
    const el = sel.selector
      ? document.querySelector(sel.selector)
      : (sel.text ? Array.from(document.querySelectorAll("body *"))
          .find(e => (e.innerText || "").toLowerCase().includes(sel.text.toLowerCase())) : null);
    if (el) return { ok: true, url: location.href };
    await new Promise(r => setTimeout(r, 200));
  }
  return { ok: false, error: "timeout" };
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
  return { id: tab.id, url: tab.url, windowId: tab.windowId };
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
  return { id: tab.id, url: tab.pendingUrl || tab.url };
}

async function getActiveTabId(explicitId) {
  if (explicitId) return explicitId;
  const [a] = await chrome.tabs.query({ active: true, currentWindow: true });
  return a?.id;
}

async function navigate({ tabId, url }) {
  const id = await getActiveTabId(tabId);
  await chrome.tabs.update(id, { url });
  await showOverlay(id);
  // Wait for load
  await new Promise((resolve) => {
    const listener = (updatedId, info) => {
      if (updatedId === id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
  });
  return { ok: true, tabId: id };
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
    return res?.result || {};
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
    return res?.result || {};
  } catch (e) { return { error: String(e) }; }
}

async function getDom({ tabId, max, includeText }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id },
    func: pageGetDom,
    args: [{ max, includeText }],
  });
  return res?.result || {};
}

async function clickEl({ tabId, ref, selector, text }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageClick, args: [{ ref, selector, text }],
  });
  return res?.result || { ok: false };
}

async function fillEl({ tabId, ref, selector, label, value, submit }) {
  const id = await getActiveTabId(tabId);
  await showOverlay(id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageFill,
    args: [{ ref, selector, label }, value, !!submit],
  });
  return res?.result || { ok: false };
}

async function selectEl({ tabId, ref, selector, value }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageSelect, args: [{ ref, selector }, value],
  });
  return res?.result || { ok: false };
}

async function scrollPage({ tabId, to, dy }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageScroll, args: [{ to, dy }],
  });
  return res?.result || { ok: false };
}

async function waitFor({ tabId, selector, text, timeoutMs }) {
  const id = await getActiveTabId(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: id }, func: pageWaitFor, args: [{ selector, text }, timeoutMs],
  });
  return res?.result || { ok: false };
}

async function releaseTab({ tabId }) {
  const id = await getActiveTabId(tabId);
  await hideOverlay(id);
  return { ok: true };
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
  get_dom: getDom,
  click: clickEl,
  fill: fillEl,
  select: selectEl,
  scroll: scrollPage,
  wait_for: waitFor,
  release_tab: releaseTab,
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
      // idle — clear overlays on any tabs we still hold
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
    // Chain: agent loops often enqueue the next command within ~1s of the
    // previous one finishing. Poll again immediately for snappier feel.
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
