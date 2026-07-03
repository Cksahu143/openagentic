// Side panel — Event Bus subscriber and control surface.

import { bridge, on } from "../shared/event-bus.js";

bridge("panel");

const $ = (id) => document.getElementById(id);
const timeline = $("timeline");

function setStatus(id, text) { const el = $(id); if (el) el.textContent = text || "—"; }

function addRow({ kind, title, meta, cls }) {
  const li = document.createElement("li");
  if (cls) li.className = cls;
  li.innerHTML = `<div class="row1"><strong></strong><span class="badge"></span></div><div class="meta"></div>`;
  li.querySelector("strong").textContent = title;
  li.querySelector(".badge").textContent = kind;
  li.querySelector(".meta").textContent = meta || "";
  timeline.appendChild(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

on("task.start", (e) => {
  setStatus("s-goal", e.payload.goal);
  setStatus("s-exp", "—");
  setStatus("s-conf", "—");
  setStatus("s-verify", "—");
  setStatus("s-recover", "—");
  setStatus("s-action", "—");
  setStatus("s-pred", "—");
  addRow({ kind: "start", title: `Task: ${e.payload.goal}`, meta: `scope: ${e.payload.scopeHost || "any"} · key: ${e.payload.normalized || ""}` });
});

on("experience.hit", (e) => {
  const p = e.payload;
  setStatus("s-exp", `${p.matchKind} · confidence ${Math.round(p.confidence * 100)}% · avg ${p.avgMs}ms`);
  addRow({ kind: "experience", cls: "ok", title: `Experience hit (${p.matchKind})`, meta: `confidence ${Math.round(p.confidence * 100)}% · avg ${p.avgMs}ms` });
});
on("experience.replay", (e) => addRow({ kind: "experience", title: `Replaying ${e.payload.workflow.length}-step workflow`, meta: `confidence ${Math.round(e.payload.confidence * 100)}%` }));
on("experience.miss", (e) => addRow({ kind: "experience", cls: "warn", title: "Experience miss", meta: e.payload.reason }));

on("plan.result", (e) => {
  const p = e.payload;
  setStatus("s-conf", `${Math.round(p.confidence * 100)}% (planner)`);
  addRow({ kind: "plan", title: `Planned ${p.workflow.length} step(s)`, meta: `${p.via} · ${p.rationale || ""}` });
});
on("reason.result", (e) => {
  const d = e.payload.decision;
  setStatus("s-action", `${d.action.type}${d.action.hint ? ` "${d.action.hint}"` : ""}${d.action.text ? ` → "${d.action.text}"` : ""}`);
  setStatus("s-pred", d.prediction ? `${d.prediction.kind}: ${d.prediction.value || ""}` : "—");
  setStatus("s-conf", `${Math.round((d.confidence || 0) * 100)}% (${d.via})`);
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
  setStatus("s-verify", v.verdict);
  const cls = v.verdict === "confirmed" ? "ok" : v.verdict === "contradicted" ? "err" : v.verdict === "skipped" ? "" : "warn";
  addRow({ kind: "verify", cls, title: v.verdict, meta: [v.notes?.join("; "), v.anomalies?.length ? `anomalies: ${v.anomalies.join(", ")}` : ""].filter(Boolean).join(" · ") });
});
on("recovery.attempt", (e) => { setStatus("s-recover", `rung ${e.payload.rung}`); addRow({ kind: "recover", cls: "warn", title: `rung ${e.payload.rung}`, meta: "" }); });
on("recovery.result", (e) => { setStatus("s-recover", e.payload.ok ? "recovered" : "failed"); addRow({ kind: "recover", cls: e.payload.ok ? "ok" : "err", title: e.payload.ok ? "recovered" : "recovery failed", meta: e.payload.note || "" }); });
on("cursor.state", (e) => setStatus("s-cursor", e.payload.state));
on("task.completed", (e) => addRow({ kind: "done", cls: "ok", title: "Task complete", meta: e.payload.reason || "" }));
on("task.escalated", (e) => addRow({ kind: "escalated", cls: "err", title: "Escalated", meta: e.payload.reason || "" }));
on("learn.saved", (e) => addRow({ kind: "learn", title: "Workflow saved", meta: `${e.payload.steps} step(s) · ${e.payload.outcome}` }));
on("log", (e) => { if (e.payload?.level === "error") addRow({ kind: "log", cls: "err", title: e.payload.msg, meta: "" }); });

on("metrics", (e) => {
  if (!e.payload?.summary) return;
  const s = e.payload.summary;
  $("metrics").textContent = Object.entries(s)
    .map(([k, v]) => `${k.padEnd(14)} p50=${v.p50}ms  p95=${v.p95}ms  avg=${v.avg}ms  n=${v.n}`)
    .join("\n");
});

function showConfirm(reason) { $("confirm-reason").textContent = reason; $("confirm-panel").classList.remove("hidden"); }
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

(async () => {
  const { oa_api_key, oa_model, oa_cursor_hidden, oa_debug_metrics } = await chrome.storage.local.get(["oa_api_key", "oa_model", "oa_cursor_hidden", "oa_debug_metrics"]);
  if (oa_api_key) $("api-key").value = oa_api_key;
  if (oa_model) $("model").value = oa_model;
  $("cursor-visible").checked = !oa_cursor_hidden;
  $("debug-metrics").checked = !!oa_debug_metrics;
  $("metrics-panel").classList.toggle("hidden", !oa_debug_metrics);
})();
$("save-settings").onclick = async () => {
  const debug = $("debug-metrics").checked;
  await chrome.storage.local.set({
    oa_api_key: $("api-key").value.trim(),
    oa_model: $("model").value.trim() || "claude-sonnet-4-5",
    oa_debug_metrics: debug,
  });
  const visible = $("cursor-visible").checked;
  await chrome.storage.local.set({ oa_cursor_hidden: !visible });
  $("metrics-panel").classList.toggle("hidden", !debug);
  chrome.runtime.sendMessage({ __oa: 1, op: "cursor-visibility", visible });
};
$("clear-experience").onclick = async () => {
  await chrome.storage.local.remove(["oa_experience_v2"]);
  addRow({ kind: "experience", cls: "warn", title: "Experience memory cleared", meta: "" });
};
