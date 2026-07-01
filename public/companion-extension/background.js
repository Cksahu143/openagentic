// OpenAgent Companion — background service worker.
// Polls Supabase every few seconds for pending commands scoped to the signed-in
// user, executes them via chrome.tabs APIs, writes results back.

const POLL_ALARM = "openagent-poll";
const POLL_PERIOD_MIN = 0.1; // 6 seconds

async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return config || null;
}

async function setConfig(cfg) {
  await chrome.storage.local.set({ config: cfg });
}

async function clearConfig() {
  await chrome.storage.local.remove("config");
}

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

// -------- Tab operations --------
async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((t) => ({
    id: t.id,
    windowId: t.windowId,
    url: t.url,
    title: t.title,
    active: t.active,
    pinned: t.pinned,
    audible: t.audible,
    status: t.status,
  }));
}

async function openTab(args) {
  const tab = await chrome.tabs.create({
    url: args.url,
    active: args.active !== false,
  });
  return { id: tab.id, url: tab.url, windowId: tab.windowId };
}

async function closeTab(args) {
  await chrome.tabs.remove(args.tabId);
  return { closed: args.tabId };
}

async function activateTab(args) {
  const tab = await chrome.tabs.update(args.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { activated: args.tabId };
}

async function searchWeb(args) {
  const q = encodeURIComponent(args.query);
  const engine = (args.engine || "google").toLowerCase();
  const urls = {
    google: `https://www.google.com/search?q=${q}`,
    duckduckgo: `https://duckduckgo.com/?q=${q}`,
    bing: `https://www.bing.com/search?q=${q}`,
  };
  const url = urls[engine] || urls.google;
  const tab = await chrome.tabs.create({ url, active: true });
  return { id: tab.id, url };
}

async function readActiveTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { error: "no active tab" };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: active.id },
      func: () => ({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, 8000),
      }),
    });
    return { url: active.url, title: active.title, ...(res?.result || {}) };
  } catch (e) {
    return { url: active.url, title: active.title, error: String(e) };
  }
}

async function readTab(args) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: args.tabId },
      func: () => ({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, 8000),
      }),
    });
    return res?.result || {};
  } catch (e) {
    return { error: String(e) };
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
  ping: async () => ({ pong: true, at: Date.now() }),
};

async function handleCommand(cfg, cmd) {
  // Mark running
  await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "running" }),
  });
  try {
    const fn = HANDLERS[cmd.action];
    if (!fn) throw new Error("Unknown action: " + cmd.action);
    const result = await fn(cmd.args || {});
    await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done", result }),
    });
  } catch (e) {
    await pgFetch(cfg, `/companion_commands?id=eq.${cmd.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "error", error: String(e?.message || e) }),
    });
  }
}

async function poll() {
  const cfg = await getConfig();
  if (!cfg) return;
  try {
    // Fetch pending commands for this device (or unassigned for the user)
    const path = `/companion_commands?status=eq.pending&or=(device_id.eq.${cfg.device_id},device_id.is.null)&order=created_at.asc&limit=5`;
    const r = await pgFetch(cfg, path);
    if (!r.ok) return;
    const cmds = await r.json();
    // update last_seen
    await pgFetch(cfg, `/companion_devices?id=eq.${cfg.device_id}`, {
      method: "PATCH",
      body: JSON.stringify({ last_seen: new Date().toISOString() }),
    });
    for (const c of cmds) {
      // Claim this device if unassigned
      if (!c.device_id) {
        await pgFetch(cfg, `/companion_commands?id=eq.${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({ device_id: cfg.device_id }),
        });
      }
      await handleCommand(cfg, c);
    }
  } catch (e) {
    console.warn("[companion] poll", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) poll();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "pair") {
      try {
        const cfg = JSON.parse(atob(msg.code));
        await setConfig(cfg);
        chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
        await poll();
        sendResponse({ ok: true, device_id: cfg.device_id, user_id: cfg.user_id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
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
