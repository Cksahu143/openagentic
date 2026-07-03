// Action Engine — Universal browser action interface.
// Dispatches real event sequences with human-plausible timing.
// Supports left/right/middle/double/triple click, hover, drag/drop,
// scroll (vertical + horizontal), full keyboard incl. modifier combos,
// type/paste/replace/clear, form/dialog interactions.

import { publish } from "../shared/event-bus.js";
import { moveCursorTo, cursorState, cursorRipple } from "../content/cursor.js";
import { nextFrame } from "../shared/wait.js";

function resolveRef(ref) {
  return document.querySelector(`[data-oa-ref="${CSS.escape(ref)}"]`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function moveAndHover(el, corr) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  await nextFrame();
  await moveCursorTo(cx, cy);
  cursorState("hovering", corr);
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cx, clientY: cy }));
  return { cx, cy };
}

const MOD_KEYS = { ctrl: "ctrlKey", control: "ctrlKey", shift: "shiftKey", alt: "altKey", meta: "metaKey", cmd: "metaKey" };
function modInit(mods = []) {
  const m = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  for (const k of mods) { const key = MOD_KEYS[String(k).toLowerCase()]; if (key) m[key] = true; }
  return m;
}

async function realClick(el, corr, { button = 0, detail = 1, mods = [] } = {}) {
  const { cx, cy } = await moveAndHover(el, corr);
  cursorState("clicking", corr);
  cursorRipple(cx, cy);
  const m = modInit(mods);
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button, ...m };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  await sleep(18 + Math.random() * 22);
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  for (let i = 1; i <= detail; i++) {
    el.dispatchEvent(new MouseEvent(button === 2 ? "contextmenu" : "click", { ...base, detail: i }));
    if (i === 2) el.dispatchEvent(new MouseEvent("dblclick", { ...base, detail: 2 }));
  }
}

function setNativeValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
    : el.isContentEditable ? null
    : HTMLInputElement.prototype;
  if (proto) {
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
  } else if (el.isContentEditable) {
    el.textContent = value;
  }
}

async function realType(el, text, corr, { replace = true, paste = false } = {}) {
  el.focus();
  cursorState("typing", corr);
  if (replace && (el.value || el.textContent)) {
    setNativeValue(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (paste) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    setNativeValue(el, (el.value || "") + text);
    el.dispatchEvent(new InputEvent("input", { data: text, inputType: "insertFromPaste", bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  let acc = el.value || el.textContent || "";
  for (const ch of text) {
    const keyEvInit = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", keyEvInit));
    el.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }));
    acc += ch;
    setNativeValue(el, acc);
    el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyEvInit));
    // human timing, low end of range
    await sleep(14 + Math.random() * 18);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function realClear(el, corr) {
  el.focus();
  cursorState("typing", corr);
  setNativeValue(el, "");
  el.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function realKey(el, key, mods = []) {
  const target = el || document.activeElement || document.body;
  const m = modInit(mods);
  const init = { key, bubbles: true, cancelable: true, ...m };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function realDrag(fromEl, toEl, corr) {
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const from = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const to = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  await moveCursorTo(from.x, from.y);
  cursorState("dragging", corr);
  const baseA = { bubbles: true, cancelable: true, clientX: from.x, clientY: from.y, button: 0 };
  fromEl.dispatchEvent(new PointerEvent("pointerdown", { ...baseA, pointerType: "mouse" }));
  fromEl.dispatchEvent(new MouseEvent("mousedown", baseA));
  // Intermediate moves
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    fromEl.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
    await moveCursorTo(x, y);
  }
  const baseB = { bubbles: true, cancelable: true, clientX: to.x, clientY: to.y, button: 0 };
  toEl.dispatchEvent(new PointerEvent("pointerup", { ...baseB, pointerType: "mouse" }));
  toEl.dispatchEvent(new MouseEvent("mouseup", baseB));
  toEl.dispatchEvent(new MouseEvent("click", baseB));
}

export async function execute(command) {
  const corr = command.correlationId || crypto.randomUUID();
  const started = performance.now();
  publish("action.dispatch.requested", { command, at: Date.now() }, corr);
  cursorState("moving", corr);
  try {
    const el = command.ref ? resolveRef(command.ref) : null;
    const needsEl = !["scroll", "key", "wait"].includes(command.type);
    if (needsEl && !el) throw new Error(`ref ${command.ref} not found`);

    const urlBefore = location.href;
    const htmlLenBefore = document.documentElement.outerHTML.length;

    switch (command.type) {
      case "click":
        await realClick(el, corr, { button: 0, detail: 1, mods: command.mods });
        break;
      case "dblclick":
        await realClick(el, corr, { button: 0, detail: 2, mods: command.mods });
        break;
      case "tripleclick":
        await realClick(el, corr, { button: 0, detail: 3, mods: command.mods });
        break;
      case "rightclick":
        await realClick(el, corr, { button: 2, detail: 1, mods: command.mods });
        break;
      case "middleclick":
        await realClick(el, corr, { button: 1, detail: 1, mods: command.mods });
        break;
      case "hover":
        await moveAndHover(el, corr);
        break;
      case "type":
        await realType(el, command.text || "", corr, { replace: command.replace !== false, paste: !!command.paste });
        break;
      case "paste":
        await realType(el, command.text || "", corr, { replace: !!command.replace, paste: true });
        break;
      case "clear":
        await realClear(el, corr);
        break;
      case "key":
        await realKey(el, command.key, command.mods || []);
        break;
      case "select":
        if (el.tagName === "SELECT") {
          const opts = [...el.options];
          const opt = opts.find((o) => o.value === command.value || o.textContent.trim() === command.value);
          if (!opt) throw new Error(`option "${command.value}" not found`);
          el.value = opt.value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          await realClick(el, corr); // combobox-style fallback
        }
        break;
      case "drag": {
        const toEl = resolveRef(command.toRef);
        if (!toEl) throw new Error(`drop target ${command.toRef} not found`);
        await realDrag(el, toEl, corr);
        break;
      }
      case "scroll": {
        const dy = command.dy ?? 400;
        const dx = command.dx ?? 0;
        if (command.ref && el) el.scrollBy({ top: dy, left: dx, behavior: "instant" });
        else window.scrollBy({ top: dy, left: dx, behavior: "instant" });
        break;
      }
      case "submit": {
        const form = el.closest("form");
        if (!form) throw new Error("no enclosing form");
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.submit?.();
        break;
      }
      case "upload": {
        if (el.tagName !== "INPUT" || el.type !== "file") throw new Error("upload target is not a file input");
        // Real uploads require user gesture; we surface a hook for tests.
        publish("action.upload-requested", { ref: command.ref, files: command.files }, corr);
        break;
      }
      case "wait":
        // handled by orchestrator's adaptive waits; here we just yield
        await nextFrame();
        break;
      default:
        throw new Error(`unknown command ${command.type}`);
    }

    await nextFrame();
    publish("action.completed", {
      type: command.type,
      ref: command.ref,
      urlChanged: location.href !== urlBefore,
      urlAfter: location.href,
      htmlDelta: document.documentElement.outerHTML.length - htmlLenBefore,
      tookMs: Math.round(performance.now() - started),
    }, corr);
    cursorState("verify", corr);
  } catch (e) {
    publish("action.failed", { command, error: String(e?.message || e) }, corr);
    cursorState("error", corr);
    throw e;
  }
}
