// Service worker (background) entry.
// - Wires the Event Bus bridge on the worker side.
// - Opens the side panel on toolbar action.
// - Handles panel RPCs: startTask, pause, resume, cancel, respondConfirm, setCursorVisible.

import { bridge, publish } from "../shared/event-bus.js";
import { runTask, pause, resume, cancel, respondToConfirmation } from "../engines/orchestrator.js";

bridge("worker");

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId != null) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) { console.warn(e); }
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__oa) return false;
  (async () => {
    try {
      if (msg.op === "start") {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!tab?.id) throw new Error("no active tab");
        const { oa_api_key, oa_model } = await chrome.storage.local.get(["oa_api_key", "oa_model"]);
        runTask({ tabId: tab.id, goal: msg.goal, apiKey: oa_api_key, model: oa_model || "claude-sonnet-4-5" });
        sendResponse({ ok: true });
      } else if (msg.op === "pause") { pause(); sendResponse({ ok: true }); }
      else if (msg.op === "resume") { resume(); sendResponse({ ok: true }); }
      else if (msg.op === "cancel") { cancel(); sendResponse({ ok: true }); }
      else if (msg.op === "confirm") { respondToConfirmation(msg.decision); sendResponse({ ok: true }); }
      else if (msg.op === "cursor-visibility") {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { __rpc: 1, op: "cursor-visibility", visible: msg.visible });
        sendResponse({ ok: true });
      } else { sendResponse({ ok: false, error: "unknown op" }); }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

publish("log", { msg: "OpenAgent worker online" });
