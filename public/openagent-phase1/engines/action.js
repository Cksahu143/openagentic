// Action Engine — Browser Driver only (Handbook Ch. 12).
// Dispatches REAL event sequences. No .click() shortcuts, no .value = "" writes.
// Human-plausible timing at the lower end of Ch. 8.3.

import { publish } from "../shared/event-bus.js";
import { moveCursorTo, cursorState } from "../content/cursor.js";

function resolveRef(ref) {
  return document.querySelector(`[data-oa-ref="${CSS.escape(ref)}"]`);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function moveAndHover(el, corr) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await moveCursorTo(cx, cy);
  cursorState("hovering", corr);
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cx, clientY: cy }));
  return { cx, cy };
}

async function realClick(el, corr) {
  const { cx, cy } = await moveAndHover(el, corr);
  cursorState("acting", corr);
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  await sleep(20 + Math.random() * 30);
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base));
}

async function realType(el, text, corr) {
  el.focus();
  cursorState("acting", corr);
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  // Clear existing content the right way if requested via {replace:true} — we always replace to match human "select-all + type".
  if (el.value) {
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  let acc = "";
  for (const ch of text) {
    const keyEvInit = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", keyEvInit));
    el.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }));
    acc += ch;
    setter?.call(el, acc);
    el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyEvInit));
    await sleep(18 + Math.random() * 22);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function execute(command) {
  const corr = command.correlationId || crypto.randomUUID();
  const started = performance.now();
  publish("action.dispatch.requested", { command, at: Date.now() }, corr);
  cursorState("moving", corr);
  try {
    const el = command.ref ? resolveRef(command.ref) : null;
    if (command.type !== "scroll" && !el) throw new Error(`ref ${command.ref} not found`);

    if (command.type === "click") {
      const urlBefore = location.href;
      const htmlLenBefore = document.documentElement.outerHTML.length;
      await realClick(el, corr);
      await sleep(60);
      const urlChanged = location.href !== urlBefore;
      publish("action.completed", { type: "click", ref: command.ref, urlChanged, urlAfter: location.href, htmlDelta: document.documentElement.outerHTML.length - htmlLenBefore, tookMs: Math.round(performance.now() - started) }, corr);
    } else if (command.type === "type") {
      await realType(el, command.text || "", corr);
      publish("action.completed", { type: "type", ref: command.ref, text: command.text, value: el.value, tookMs: Math.round(performance.now() - started) }, corr);
    } else if (command.type === "hover") {
      await moveAndHover(el, corr);
      publish("action.completed", { type: "hover", ref: command.ref, tookMs: Math.round(performance.now() - started) }, corr);
    } else if (command.type === "scroll") {
      const dy = command.dy ?? 400;
      window.scrollBy({ top: dy, behavior: "instant" });
      await sleep(40);
      publish("action.completed", { type: "scroll", dy, tookMs: Math.round(performance.now() - started) }, corr);
    } else if (command.type === "submit") {
      const form = el.closest("form");
      if (!form) throw new Error("no enclosing form");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.submit?.();
      publish("action.completed", { type: "submit", ref: command.ref, tookMs: Math.round(performance.now() - started) }, corr);
    } else {
      throw new Error(`unknown command ${command.type}`);
    }
    cursorState("verify", corr);
  } catch (e) {
    publish("action.failed", { command, error: String(e?.message || e) }, corr);
    cursorState("error", corr);
    throw e;
  }
}
