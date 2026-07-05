// Clipboard action test — verifies copy / cut / paste end-to-end against a
// minimal simulated DOM, including the action-verification event stream.
//
// Run: node public/openagent-phase1/tests/clipboard.test.js
//
// This test stubs the browser APIs the Action Engine touches (document,
// selection, execCommand, navigator.clipboard, PointerEvent/MouseEvent,
// requestAnimationFrame, the cursor helpers). It then imports the real
// engines/action.js module, dispatches copy/cut/paste commands, and asserts
// that:
//   1. the OS-clipboard write path runs (execCommand + navigator.clipboard),
//   2. cut removes the source text,
//   3. paste inserts the clipboard contents into the target field,
//   4. the event bus emits action.completed with verification metadata
//      (urlChanged, htmlDelta, tookMs) for every step.

import { on } from "../shared/event-bus.js";

// ---- polyfills ----------------------------------------------------------

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => "test-" + Math.random().toString(36).slice(2) },
  });
}
globalThis.performance ??= { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.CSS ??= { escape: (s) => String(s).replace(/"/g, '\\"') };

// Event constructors — minimal shims.
class FakeEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); this.bubbles = !!init.bubbles; }
}
globalThis.Event = FakeEvent;
globalThis.PointerEvent = class extends FakeEvent {};
globalThis.MouseEvent = class extends FakeEvent {};
globalThis.KeyboardEvent = class extends FakeEvent {};
globalThis.InputEvent = class extends FakeEvent {};
globalThis.ClipboardEvent = class extends FakeEvent {};

class FakeDT {
  constructor() { this._m = new Map(); }
  setData(t, v) { this._m.set(t, v); }
  getData(t) { return this._m.get(t) ?? ""; }
}
globalThis.DataTransfer = FakeDT;

// ---- fake DOM element ---------------------------------------------------

// The Action Engine uses HTMLInputElement/HTMLTextAreaElement prototypes to
// find the native `value` setter. Provide a minimal shim that stores writes
// on a private slot so the reader (`el.value`) picks them up.
const nativeValueDesc = {
  set(v) {
    Object.defineProperty(this, "_ov", { value: v, writable: true, configurable: true });
  },
  get() { return this._ov ?? ""; },
  configurable: true,
};
globalThis.HTMLInputElement = function () {};
Object.defineProperty(globalThis.HTMLInputElement.prototype, "value", nativeValueDesc);
globalThis.HTMLTextAreaElement = function () {};
Object.defineProperty(globalThis.HTMLTextAreaElement.prototype, "value", nativeValueDesc);

// ---- fake DOM element ---------------------------------------------------

function makeField({ tagName = "INPUT", type = "text", value = "" } = {}) {
  const listeners = new Map();
  const field = Object.create(globalThis.HTMLInputElement.prototype);
  Object.assign(field, {
    tagName, type,
    _ov: value,
    isContentEditable: false,
    selectionStart: 0, selectionEnd: value.length,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30 }),
    scrollIntoView() {},
    focus() { activeElement = field; },
    select() { field.selectionStart = 0; field.selectionEnd = (field.value || "").length; },
    getAttribute() { return null; },
    closest() { return null; },
    dispatchEvent(ev) {
      const arr = listeners.get(ev.type);
      if (arr) for (const fn of arr) fn.call(field, ev);
      return true;
    },
    addEventListener(t, fn) {
      if (!listeners.get(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener() {},
  });
  return field;
}

// ---- fake document / OS clipboard --------------------------------------

let activeElement = null;
const inputField = makeField({ value: "hello world" });
const targetField = makeField({ value: "" });

const refs = { "src": inputField, "dst": targetField };

let osClipboard = "";
let selectedText = "";

function makeContainer() {
  return {
    style: {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return { style: {} }; },
    innerHTML: "",
  };
}

globalThis.document = {
  documentElement: { outerHTML: "<html></html>", appendChild() {}, setAttribute() {} },
  head: { appendChild() {} },
  activeElement: null,
  body: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  createElement: () => makeContainer(),
  querySelector: (sel) => {
    const m = /data-oa-ref="([^"]+)"/.exec(sel);
    return m ? refs[m[1]] ?? null : null;
  },
  createRange: () => ({ selectNodeContents() {} }),
  execCommand: (cmd) => {
    const el = activeElement;
    if (!el) return false;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? (el.value || "").length;
    const slice = (el.value || "").slice(s, e);
    if (cmd === "copy") { osClipboard = slice; return true; }
    if (cmd === "cut") {
      osClipboard = slice;
      el.value = (el.value || "").slice(0, s) + (el.value || "").slice(e);
      el.selectionStart = el.selectionEnd = s;
      return true;
    }
    return false;
  },
};
globalThis.chrome = {
  runtime: { getURL: (p) => `chrome-ext://test/${p}` },
  storage: { local: { get: (_k, cb) => cb({}), set() {} } },
};
globalThis.window = { getSelection: () => ({
  removeAllRanges() { selectedText = ""; },
  addRange() { selectedText = inputField.value; },
  toString() { return selectedText; },
})};
Object.defineProperty(window, Symbol.toPrimitive, { value: () => "" });

let clipboardWrites = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (t) => { osClipboard = t; clipboardWrites++; },
      readText: async () => osClipboard,
    },
  },
});

globalThis.location = { href: "http://test/local" };

// The action engine imports the cursor helpers. Stub them via a loader shim
// so the import resolves without a real DOM.
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const stubDir = resolve(__dirname, "../content");
mkdirSync(stubDir, { recursive: true });
// If cursor.js relies on document.body etc it might still work; import lazily.

// ---- bus capture --------------------------------------------------------

const captured = [];
on("action.completed", (env) => captured.push(env));
on("action.clipboard.copy", (env) => captured.push(env));
on("action.clipboard.cut", (env) => captured.push(env));
on("action.clipboard.paste", (env) => captured.push(env));
on("action.failed", (env) => captured.push(env));

// ---- run ---------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

const { execute } = await import("../engines/action.js");

// 1. COPY from source field
await execute({ type: "copy", ref: "src", correlationId: "c1" });
assert(osClipboard === "hello world", `copy wrote clipboard, got "${osClipboard}"`);
assert(clipboardWrites >= 1, "navigator.clipboard.writeText fallback ran");
assert(captured.some((e) => e.type === "action.clipboard.copy"), "copy event emitted");
assert(captured.some((e) => e.type === "action.completed" && e.payload.type === "copy"),
  "copy verification event emitted");

// 2. CUT the source field
await execute({ type: "cut", ref: "src", correlationId: "c2" });
assert(inputField.value === "", `cut cleared source, got "${inputField.value}"`);
assert(osClipboard === "hello world", "cut clipboard content preserved");
assert(captured.some((e) => e.type === "action.clipboard.cut"), "cut event emitted");
assert(captured.some((e) => e.type === "action.completed" && e.payload.type === "cut"),
  "cut verification event emitted");

// 3. PASTE into destination — reads from OS clipboard when no text is given
await execute({ type: "paste", ref: "dst", correlationId: "c3", replace: true });
assert(targetField.value === "hello world",
  `paste wrote destination, got "${targetField.value}"`);
assert(captured.some((e) => e.type === "action.clipboard.paste"), "paste event emitted");
assert(captured.some((e) => e.type === "action.completed" && e.payload.type === "paste"),
  "paste verification event emitted");

// 4. verification envelope shape (tookMs / urlChanged / htmlDelta present)
const completed = captured.filter((e) => e.type === "action.completed");
for (const ev of completed) {
  assert(typeof ev.payload.tookMs === "number", "tookMs numeric");
  assert(typeof ev.payload.urlChanged === "boolean", "urlChanged boolean");
  assert(typeof ev.payload.htmlDelta === "number", "htmlDelta numeric");
}

// 5. no action.failed events
assert(!captured.some((e) => e.type === "action.failed"),
  "no action.failed events during clipboard flow");

console.log(`ok — clipboard passes (${completed.length} verifications, ${clipboardWrites} clipboard writes)`);
