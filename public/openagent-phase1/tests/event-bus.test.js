// Standalone unit test — run with `node public/openagent-phase1/tests/event-bus.test.js`.
// No engine imports; validates envelope schema + pub/sub delivery only.
import { on, publish } from "../shared/event-bus.js";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "test-" + Math.random() } });

let seen = null;
on("log", (env) => { seen = env; });
publish("log", { msg: "hello" });
if (!seen || seen.payload.msg !== "hello") { console.error("FAIL: local delivery"); process.exit(1); }
if (typeof seen.timestamp !== "number" || !seen.correlationId) { console.error("FAIL: envelope shape"); process.exit(1); }

try {
  publish({ type: "nope", timestamp: 1, correlationId: "x", payload: {} });
  console.error("FAIL: bad type accepted"); process.exit(1);
} catch { /* expected */ }

console.log("ok — event-bus passes");
