// Perception Engine — DOM + accessibility tree only (Handbook Ch. 11).
// Content-script side. Publishes `perception.snapshot.ready`.
//
// Correctness rules from Ch. 11:
//   - Compute visibility from getComputedStyle + bounding rect + elementFromPoint,
//     never DOM presence alone.
//   - Viewport-visible elements first; off-screen only as tail.
//   - Cap payload size (interactive elements only + a small semantic summary).
//   - Debounce mutation observations (~75ms) but also snapshot on demand.

import { publish } from "../shared/event-bus.js";

const REF_ATTR = "data-oa-ref";
let refCounter = 0;
let lastSnapshotAt = 0;

const INTERACTIVE_SEL = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea",
  "[role=button]", "[role=link]", "[role=checkbox]", "[role=menuitem]",
  "[role=tab]", "[role=option]", "[role=searchbox]", "[role=textbox]",
  "[contenteditable]", "[onclick]", "summary", "label",
].join(",");

function stableRef(el) {
  let r = el.getAttribute(REF_ATTR);
  if (!r) { r = "oa" + (++refCounter); el.setAttribute(REF_ATTR, r); }
  return r;
}

function isVisible(el, rect, cs) {
  if (!rect || rect.width < 2 || rect.height < 2) return false;
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (parseFloat(cs.opacity) < 0.05) return false;
  if (cs.pointerEvents === "none") return false;
  return true;
}

function isOccluded(el, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return "offscreen";
  const hit = document.elementFromPoint(cx, cy);
  if (!hit) return "no-hit";
  if (hit === el || el.contains(hit) || hit.contains(el)) return false;
  return "occluded";
}

function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const parts = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    const id = el.id;
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return lab.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.textContent.trim();
    if (el.placeholder) return el.placeholder;
    if (el.name) return el.name;
  }
  const t = (el.innerText || el.textContent || "").trim();
  if (t) return t.slice(0, 140);
  return el.getAttribute("title") || "";
}

function role(el) {
  const r = el.getAttribute("role");
  if (r) return r;
  const t = el.tagName;
  if (t === "A") return "link";
  if (t === "BUTTON") return "button";
  if (t === "INPUT") return `input:${el.type || "text"}`;
  if (t === "TEXTAREA") return "textbox";
  if (t === "SELECT") return "combobox";
  return t.toLowerCase();
}

export function snapshot({ full = false } = {}) {
  const t0 = performance.now();
  const url = location.href;
  const title = document.title;
  const raw = Array.from(document.querySelectorAll(INTERACTIVE_SEL));

  const items = [];
  for (const el of raw) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!isVisible(el, rect, cs)) continue;
    const occ = isOccluded(el, rect);
    const viewport = rect.top >= 0 && rect.top < innerHeight;
    items.push({
      ref: stableRef(el),
      role: role(el),
      name: accessibleName(el),
      value: (el.value ?? "").toString().slice(0, 200) || undefined,
      checked: el.checked || undefined,
      disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
      href: el.href || undefined,
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      viewport,
      occluded: occ === "occluded" ? true : undefined,
    });
    if (items.length > (full ? 500 : 120)) break;
  }
  // viewport-first ordering
  items.sort((a, b) => Number(!!b.viewport) - Number(!!a.viewport));

  const headings = Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 10).map((h) => ({
    level: Number(h.tagName[1]), text: (h.textContent || "").trim().slice(0, 140),
  }));

  const dialogs = Array.from(document.querySelectorAll("[role=dialog],dialog[open]")).map((d) => ({
    ref: stableRef(d), text: (d.textContent || "").trim().slice(0, 200),
  }));

  const pageState = document.readyState === "complete" ? "ready" : "loading";
  const summary = `${title} — ${items.length} interactive elements, ${headings.length} headings${dialogs.length ? `, ${dialogs.length} dialog(s) open` : ""}`;

  const snap = {
    url, title, pageState, summary, headings, dialogs,
    elements: items,
    tookMs: Math.round(performance.now() - t0),
    at: Date.now(),
  };
  lastSnapshotAt = snap.at;
  return snap;
}

let debounceTimer = null;
export function startObserver() {
  const mo = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const s = snapshot();
      publish("perception.snapshot.ready", s);
    }, 75);
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: false });
  return mo;
}

export function lastAt() { return lastSnapshotAt; }
