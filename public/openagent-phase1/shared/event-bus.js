// Typed pub/sub. Runs per-context (worker, content, panel). Cross-context
// traffic is forwarded transparently via chrome.runtime messages when
// `bridge(role)` is called on startup.
//
// Handbook Ch. 5: every event has {type, timestamp, correlationId, payload}
// and is schema-validated on publish.

import { validateEnvelope, newEnvelope } from "./schemas.js";

const listeners = new Map(); // type -> Set<fn>
const wildcards = new Set();
let bridgeSend = null; // (env) => void — set by bridge()
let selfRole = null;

export function on(type, fn) {
  if (type === "*") {
    wildcards.add(fn);
    return () => wildcards.delete(fn);
  }
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

function deliverLocal(env) {
  const set = listeners.get(env.type);
  if (set) for (const fn of set) { try { fn(env); } catch (e) { console.error("[bus]", e); } }
  for (const fn of wildcards) { try { fn(env); } catch (e) { console.error("[bus]", e); } }
}

export function publish(typeOrEnv, payload, correlationId) {
  const env = typeof typeOrEnv === "string"
    ? newEnvelope(typeOrEnv, payload, correlationId)
    : typeOrEnv;
  validateEnvelope(env);
  deliverLocal(env);
  if (bridgeSend && env.__origin !== selfRole) {
    // stamp origin so we don't reflect back
    bridgeSend({ ...env, __origin: selfRole });
  }
  return env;
}

// Wire chrome.runtime as the cross-context bridge.
// role: "worker" | "content" | "panel"
export function bridge(role) {
  selfRole = role;

  if (role === "worker") {
    // worker receives from panel & content, rebroadcasts to everyone else.
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.__bus !== 1) return;
      try {
        validateEnvelope(msg.env);
        deliverLocal(msg.env);
        // fan out to all other contexts
        // -> content of active tab
        if (sender.tab?.id) {
          // came from content; broadcast to panel + workers is already local
        } else {
          // came from panel; forward to content of active tab if any
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab?.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
          });
        }
        // panel receives via broadcast helper below
        chrome.runtime.sendMessage(msg).catch(() => {});
      } catch (e) {
        console.warn("[bus] invalid envelope", e);
      }
      sendResponse?.({ ok: true });
      return false;
    });
    bridgeSend = (env) => {
      // worker publishing: fan out to panel + content
      const msg = { __bus: 1, env };
      chrome.runtime.sendMessage(msg).catch(() => {});
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      });
    };
  } else {
    // content or panel: forward to worker
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.__bus !== 1) return;
      try {
        validateEnvelope(msg.env);
        if (msg.env.__origin !== selfRole) deliverLocal(msg.env);
      } catch (e) {
        console.warn("[bus] invalid envelope", e);
      }
      return false;
    });
    bridgeSend = (env) => {
      chrome.runtime.sendMessage({ __bus: 1, env }).catch(() => {});
    };
  }
}
