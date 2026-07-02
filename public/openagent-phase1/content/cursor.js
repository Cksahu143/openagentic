// AI Cursor (Handbook Ch. 20). Overlay driven only by real Action Engine
// timestamps — no independent animation timeline.

import { publish } from "../shared/event-bus.js";

let root = null;
let visible = true;
let currentState = "idle";

function ensureRoot() {
  if (root) return root;
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = chrome.runtime.getURL("content/cursor.css");
  document.head.appendChild(style);

  root = document.createElement("div");
  root.id = "oa-cursor";
  root.setAttribute("data-state", "idle");
  root.innerHTML = `
    <div class="oa-ring"></div>
    <svg class="oa-arrow" viewBox="0 0 24 24" fill="none">
      <path d="M4 2 L20 12 L13 13 L11 21 Z" fill="#60a5fa" stroke="#1e293b" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  document.documentElement.appendChild(root);
  chrome.storage?.local.get(["oa_cursor_hidden"], (v) => {
    if (v?.oa_cursor_hidden) { visible = false; root.setAttribute("data-hidden", "1"); }
  });
  return root;
}

export function setCursorVisible(v) {
  visible = !!v;
  ensureRoot();
  root.setAttribute("data-hidden", visible ? "0" : "1");
  chrome.storage?.local.set({ oa_cursor_hidden: !visible });
}

export function moveCursorTo(x, y) {
  ensureRoot();
  root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  // wait for CSS transition end (approx)
  return new Promise((r) => setTimeout(r, 240));
}

export function cursorState(state, correlationId) {
  ensureRoot();
  currentState = state;
  root.setAttribute("data-state", state);
  publish("cursor.state", { state }, correlationId);
}

// Initialize idle cursor at first user event so it appears once page has interaction.
export function initCursor() { ensureRoot(); }
