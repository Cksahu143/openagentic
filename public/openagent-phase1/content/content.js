// Content-script entry. Wires Perception + Action + Verification + Cursor
// to the Event Bus and handles messages from the service worker.

import { bridge, on, publish } from "../shared/event-bus.js";
import { snapshot, startObserver } from "../engines/perception.js";
import { execute } from "../engines/action.js";
import { verify } from "../engines/verification.js";
import { initCursor, setCursorVisible, cursorState } from "./cursor.js";
import { attemptRecovery } from "../engines/recovery.js";

bridge("content");
initCursor();
startObserver();

// Direct RPC channel: worker asks content to do things and waits for a reply
// synchronously via chrome.runtime.sendMessage. We keep this outside the bus
// so the orchestrator can await results cleanly.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.__rpc) return false;
  (async () => {
    try {
      if (msg.op === "snapshot") {
        const s = snapshot(msg.args || {});
        publish("perception.snapshot.ready", s);
        sendResponse({ ok: true, snapshot: s });
      } else if (msg.op === "act") {
        const preSnap = snapshot();
        await execute(msg.command);
        // brief settle
        await new Promise((r) => setTimeout(r, 120));
        const postSnap = snapshot();
        const result = verify({
          prePerception: preSnap,
          postPerception: postSnap,
          prediction: msg.prediction,
          actionResult: {},
        });
        publish("verification.result", { ...result, prediction: msg.prediction });
        cursorState(result.verdict === "confirmed" ? "success" : result.verdict === "contradicted" ? "error" : "idle");
        sendResponse({ ok: true, verification: result, post: postSnap });
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
  return true; // async response
});

on("log", (env) => console.log("[oa]", env.payload));
