// Side panel — vanilla, read-only Event Bus subscriber.
// Deviates from the plan (React) to avoid a bundler; behaviorally equivalent.

import { bridge, on } from "../shared/event-bus.js";

bridge("panel");

const $ = (id) => document.getElementById(id);
const timeline = $("timeline");

function addRow({ kind, title, meta, cls }) {
  const li = document.createElement("li");
  if (cls) li.className = cls;
  li.innerHTML = `
    <div class="row1">
      <strong></strong>
      <span class="badge"></span>
    </div>
    <div class="meta"></div>`;
  li.querySelector("strong").textContent = title;
  li.querySelector(".badge").textContent = kind;
  li.querySelector(".meta").textContent = meta || "";
  timeline.appendChild(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

// Timeline mapping — one row per meaningful bus event.
on("task.start", (e) => addRow({ kind: "start", title: `Task: ${e.payload.goal}`, meta: `scope: ${e.payload.scopeHost || "any"}` }));
on("reason.result", (e) => {
  const d = e.payload.decision;
  addRow({
    kind: `step ${e.payload.step}`,
    title: `${d.action.type}${d.action.hint ? ` "${d.action.hint}"` : ""}${d.action.text ? ` → "${d.action.text}"` : ""}`,
    meta: `${d.via} · confidence ${Math.round((d.confidence || 0) * 100)}% · ${d.rationale || ""}`,
  });
});
on("guardrail.blocked", (e) => {
  showConfirm(e.payload.reason || "Confirm this action?");
  addRow({ kind: "guardrail", cls: "warn", title: "Guardrail requires confirmation", meta: e.payload.reason || "" });
});
on("guardrail.approved", () => addRow({ kind: "guardrail", cls: "ok", title: "Approved", meta: "" }));
on("guardrail.denied", () => addRow({ kind: "guardrail", cls: "err", title: "Denied", meta: "" }));
on("verification.result", (e) => {
  const v = e.payload.verification;
  const cls = v.verdict === "confirmed" ? "ok" : v.verdict === "contradicted" ? "err" : "warn";
  addRow({ kind: "verify", cls, title: v.verdict, meta: [v.notes?.join("; "), v.anomalies?.length ? `anomalies: ${v.anomalies.join(", ")}` : ""].filter(Boolean).join(" · ") });
});
on("recovery.attempt", (e) => addRow({ kind: "recover", cls: "warn", title: `rung ${e.payload.rung}`, meta: "" }));
on("recovery.result", (e) => addRow({ kind: "recover", cls: e.payload.ok ? "ok" : "err", title: e.payload.ok ? "recovered" : "recovery failed", meta: e.payload.note || "" }));
on("task.completed", (e) => addRow({ kind: "done", cls: "ok", title: "Task complete", meta: e.payload.reason || "" }));
on("task.escalated", (e) => addRow({ kind: "escalated", cls: "err", title: "Escalated", meta: e.payload.reason || "" }));
on("log", (e) => { if (e.payload?.level === "error") addRow({ kind: "log", cls: "err", title: e.payload.msg, meta: "" }); });

on("metrics", (e) => {
  if (!e.payload?.summary) return;
  const s = e.payload.summary;
  $("metrics").textContent = Object.entries(s)
    .map(([k, v]) => `${k}: p50=${v.p50}ms p95=${v.p95}ms n=${v.n}`)
    .join("\n");
});

function showConfirm(reason) {
  $("confirm-reason").textContent = reason;
  $("confirm-panel").classList.remove("hidden");
}
function hideConfirm() { $("confirm-panel").classList.add("hidden"); }

$("confirm-approve").onclick = () => { chrome.runtime.sendMessage({ __oa: 1, op: "confirm", decision: "approve" }); hideConfirm(); };
$("confirm-deny").onclick = () => { chrome.runtime.sendMessage({ __oa: 1, op: "confirm", decision: "deny" }); hideConfirm(); };

$("start").onclick = async () => {
  const goal = $("goal").value.trim();
  if (!goal) return;
  timeline.innerHTML = "";
  await chrome.runtime.sendMessage({ __oa: 1, op: "start", goal });
};
$("pause").onclick = () => chrome.runtime.sendMessage({ __oa: 1, op: "pause" });
$("resume").onclick = () => chrome.runtime.sendMessage({ __oa: 1, op: "resume" });
$("cancel").onclick = () => chrome.runtime.sendMessage({ __oa: 1, op: "cancel" });

// Settings
(async () => {
  const { oa_api_key, oa_model, oa_cursor_hidden } = await chrome.storage.local.get(["oa_api_key", "oa_model", "oa_cursor_hidden"]);
  if (oa_api_key) $("api-key").value = oa_api_key;
  if (oa_model) $("model").value = oa_model;
  $("cursor-visible").checked = !oa_cursor_hidden;
})();
$("save-settings").onclick = async () => {
  await chrome.storage.local.set({
    oa_api_key: $("api-key").value.trim(),
    oa_model: $("model").value.trim() || "claude-sonnet-4-5",
  });
  const visible = $("cursor-visible").checked;
  await chrome.storage.local.set({ oa_cursor_hidden: !visible });
  chrome.runtime.sendMessage({ __oa: 1, op: "cursor-visibility", visible });
};
