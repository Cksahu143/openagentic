// Verification Engine — full impl (Handbook Ch. 16).
// Three comparator passes: structural diff, targeted predicted-delta check,
// anomaly scan. Verdict: confirmed | unconfirmed | contradicted.

export function verify({ prePerception, postPerception, prediction, actionResult }) {
  const notes = [];
  let structural = false, targeted = null, anomalies = [];

  // Pass 1: structural diff — did *something* meaningfully change?
  if (prePerception.url !== postPerception.url) { structural = true; notes.push("url changed"); }
  else if (prePerception.title !== postPerception.title) { structural = true; notes.push("title changed"); }
  else if (Math.abs(prePerception.elements.length - postPerception.elements.length) >= 1) {
    structural = true; notes.push(`element count ${prePerception.elements.length}->${postPerception.elements.length}`);
  } else if ((prePerception.dialogs?.length || 0) !== (postPerception.dialogs?.length || 0)) {
    structural = true; notes.push("dialog count changed");
  }

  // Pass 2: targeted predicted-delta check.
  // prediction schema (see Intelligence): { kind: "urlContains"|"newElementNamed"|"fieldValueEquals"|"pageReady"|"textVisible", ...args }
  if (prediction && prediction.kind) {
    if (prediction.kind === "urlContains") {
      targeted = postPerception.url.includes(prediction.value);
    } else if (prediction.kind === "newElementNamed") {
      const want = (prediction.value || "").toLowerCase();
      const preNames = new Set(prePerception.elements.map((e) => (e.name || "").toLowerCase()));
      targeted = postPerception.elements.some((e) => (e.name || "").toLowerCase().includes(want) && !preNames.has((e.name || "").toLowerCase()));
    } else if (prediction.kind === "fieldValueEquals") {
      const el = postPerception.elements.find((e) => e.ref === prediction.ref);
      targeted = !!el && (el.value || "") === prediction.value;
    } else if (prediction.kind === "pageReady") {
      targeted = postPerception.pageState === "ready";
    } else if (prediction.kind === "textVisible") {
      const want = (prediction.value || "").toLowerCase();
      targeted = postPerception.elements.some((e) => (e.name || "").toLowerCase().includes(want))
        || (postPerception.headings || []).some((h) => (h.text || "").toLowerCase().includes(want));
    } else {
      targeted = null;
    }
  }

  // Pass 3: anomaly scan.
  const preDialogs = prePerception.dialogs?.length || 0;
  const postDialogs = postPerception.dialogs?.length || 0;
  if (postDialogs > preDialogs) anomalies.push("new dialog opened");
  const errorTerms = /(error|failed|denied|not found|try again)/i;
  const preHeadingTexts = new Set((prePerception.headings || []).map((h) => h.text));
  for (const h of postPerception.headings || []) {
    if (!preHeadingTexts.has(h.text) && errorTerms.test(h.text || "")) anomalies.push(`error heading: ${h.text}`);
  }

  // Decide verdict.
  let verdict;
  if (targeted === true) verdict = "confirmed";
  else if (targeted === false) verdict = "contradicted";
  else if (structural && anomalies.length === 0) verdict = "unconfirmed";
  else if (!structural && actionResult?.urlChanged) verdict = "confirmed";
  else verdict = anomalies.length ? "contradicted" : "unconfirmed";

  return { verdict, structural, targeted, anomalies, notes };
}
