// AI Cursor (Handbook Ch. 20) — richer state machine.
// States: idle, thinking, moving, hovering, clicking, typing, dragging,
// waiting, recovering, success, error, verify.
// Animations run on the GPU (transform/opacity) so they never block execution.

import { publish } from "../shared/event-bus.js";

let root = null;
let ringEl = null;
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
    <div class="oa-glow"></div>
    <svg class="oa-arrow" viewBox="0 0 24 24" fill="none">
      <path d="M4 2 L20 12 L13 13 L11 21 Z" fill="#60a5fa" stroke="#0f172a" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  ringEl = root.querySelector(".oa-ring");
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
  return new Promise((r) => {
    const onEnd = () => { root.removeEventListener("transitionend", onEnd); r(null); };
    root.addEventListener("transitionend", onEnd, { once: true });
    // Safety cap so we never stall the action loop
    setTimeout(onEnd, 260);
  });
}

export function cursorState(state, correlationId) {
  ensureRoot();
  if (state === currentState) return;
  currentState = state;
  root.setAttribute("data-state", state);
  publish("cursor.state", { state }, correlationId);
}

export function cursorRipple(x, y) {
  ensureRoot();
  const rip = document.createElement("div");
  rip.className = "oa-ripple";
  rip.style.left = `${x}px`;
  rip.style.top = `${y}px`;
  document.documentElement.appendChild(rip);
  rip.addEventListener("animationend", () => rip.remove(), { once: true });
  setTimeout(() => rip.remove(), 800);
}

export function initCursor() { ensureRoot(); }
