// Goal normalization — canonicalize task phrasing so Experience Memory
// matches across wording variants ("open youtube" / "Go to YouTube.").

const STOP = new Set([
  "the", "a", "an", "to", "please", "kindly", "just", "then", "and", "on", "in",
  "at", "of", "for", "with", "into", "onto",
]);

const VERB_ALIASES = new Map([
  ["goto", "open"], ["visit", "open"], ["launch", "open"], ["navigate", "open"],
  ["go", "open"], ["load", "open"],
  ["find", "search"], ["lookup", "search"], ["google", "search"], ["query", "search"],
  ["press", "click"], ["tap", "click"], ["hit", "click"], ["select", "click"],
  ["fill", "type"], ["enter", "type"], ["input", "type"], ["write", "type"],
]);

/**
 * Normalize a goal string to a stable canonical form used as a memory key.
 * - lowercase
 * - strip punctuation
 * - collapse whitespace
 * - drop stopwords
 * - alias verbs (goto/visit/navigate -> open, google/find -> search)
 * @param {string} goal
 * @returns {{ key: string, tokens: string[], original: string }}
 */
export function normalizeGoal(goal) {
  const original = String(goal || "");
  const clean = original.toLowerCase().replace(/[^\p{L}\p{N}\s'"-]/gu, " ").replace(/\s+/g, " ").trim();
  const raw = clean.split(" ").filter(Boolean);
  const tokens = [];
  for (const t of raw) {
    if (STOP.has(t)) continue;
    tokens.push(VERB_ALIASES.get(t) || t);
  }
  return { key: tokens.join(" "), tokens, original };
}

/** Rough similarity for near-match memory lookup (Jaccard on token sets). */
export function goalSimilarity(a, b) {
  const A = new Set(normalizeGoal(a).tokens);
  const B = new Set(normalizeGoal(b).tokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
