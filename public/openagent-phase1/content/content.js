// Content-script entry. Wires Perception + Action + Verification + Cursor
// to the Event Bus and handles RPCs from the service worker.

import { bridge, on, publish } from "../shared/event-bus.js";
import { snapshot, startObserver } from "../engines/perception.js";
import { execute } from "../engines/action.js";
import { verify } from "../engines/verification.js";
import { initCursor, setCursorVisible, cursorState } from "./cursor.js";
import { attemptRecovery } from "../engines/recovery.js";
import { predict, isCheckpoint } from "../engines/predictor.js";
import { waitForDomIdle, waitForNavigation } from "../shared/wait.js";

bridge("content");
initCursor();
startObserver();

async function runOneStep(command, prediction) {
  const preSnap = snapshot();
  await execute(command);
  // Adaptive settle: for click/submit prefer navigation event; for type prefer DOM idle.
  if (command.type === "submit" || (command.type === "click" && preSnap.elements.find((e) => e.ref === command.ref)?.href)) {
    await waitForNavigation({ from: preSnap.url, timeout: 4000 });
    await waitForDomIdle({ quietMs: 200, timeout: 3000 });
  } else {
    await waitForDomIdle({ quietMs: 150, timeout: 1500 });
  }
  const postSnap = snapshot({ force: true });
  const result = verify({
    prePerception: preSnap,
    postPerception: postSnap,
    prediction: prediction || predict(command, preSnap),
    actionResult: {},
  });
  publish("verification.result", { ...result, prediction });
  cursorState(result.verdict === "confirmed" ? "success" : result.verdict === "contradicted" ? "error" : "idle");
  return { verification: result, post: postSnap };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.__rpc) return false;
  (async () => {
    try {
      if (msg.op === "snapshot") {
        const s = snapshot(msg.args || {});
        publish("perception.snapshot.ready", s);
        sendResponse({ ok: true, snapshot: s });
      } else if (msg.op === "act") {
        const r = await runOneStep(msg.command, msg.prediction);
        sendResponse({ ok: true, ...r });
      } else if (msg.op === "batch") {
        // Execute a sequence of actions with checkpoint-only verification.
        const results = [];
        for (const step of msg.workflow) {
          if (!step?.action) continue;
          const preSnap = snapshot();
          const el = step.action.ref ? preSnap.elements.find((e) => e.ref === step.action.ref) : null;
          const shouldVerify = step.checkpoint || isCheckpoint(step.action, el);
          if (shouldVerify) {
            const r = await runOneStep(step.action, step.prediction);
            results.push({ step, ...r });
            if (r.verification.verdict === "contradicted") break;
          } else {
            await execute(step.action);
            await waitForDomIdle({ quietMs: 120, timeout: 800 });
            results.push({ step, verification: { verdict: "skipped", structural: false, targeted: null, anomalies: [], notes: ["non-checkpoint"] } });
          }
        }
        sendResponse({ ok: true, results, post: snapshot({ force: true }) });
      } else if (msg.op === "recover") {
        const out = await attemptRecovery(msg.rung, msg.context);
        sendResponse({ ok: true, ...out });
      } else if (msg.op === "cursor-visibility") {
        setCursorVisible(msg.visible);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown op" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

on("log", (env) => console.log("[oa]", env.payload));
