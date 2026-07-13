/**
 * Bridge to the Python multi-agent service (python-service/). Server-only —
 * do not import from client code.
 *
 * This does NOT replace the existing companion browser tools or the
 * /api/chat streaming loop. It's an opt-in escalation path for goals that
 * need Python-native capabilities (pandas-style data work, PyMuPDF/pdfplumber
 * document parsing, semantic long-term memory) that don't have a good JS
 * equivalent. The chat route can call `runPythonAgent` as an additional
 * tool (`delegate_to_python_agent`) alongside its existing tools.
 *
 * Auth: a shared secret, not per-user auth — Supabase RLS/session auth
 * already happened upstream in the TS server before this is ever called.
 */
import { logActivity } from "@/lib/logger";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const PYTHON_SERVICE_TOKEN = process.env.PYTHON_SERVICE_TOKEN ?? "";
const DEFAULT_TIMEOUT_MS = 45_000;

class PythonServiceError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "PythonServiceError";
  }
}

async function callPythonService<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/api/v1${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenAgent-Bridge-Token": PYTHON_SERVICE_TOKEN,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PythonServiceError(`Python service ${path} failed: ${res.status} ${text}`, res.status);
    }

    return (await res.json()) as T;
  } catch (err) {
    await logActivity({
      module: "python-bridge",
      level: "error",
      message: `Call to ${path} failed`,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generic passthrough to any registered Python tool (see python-service
 * GET /api/v1/tools for the live list — includes agent_browser_navigate,
 * agent_browser_click, agent_browser_fill, agent_browser_screenshot,
 * agent_browser_upload_file, agent_browser_list_tabs, agent_browser_new_tab,
 * agent_browser_close_tab, workspace_*, read_pdf, read_docx, image_info, etc).
 * Used for tools that don't need bespoke typed wrappers.
 */
export async function executePythonTool(
  tool: string,
  input: Record<string, unknown>,
  permissions: string[],
): Promise<{ ok: boolean; output?: unknown; error?: string | null }> {
  return callPythonService("/tools/execute", { tool, input, permissions }, 30_000);
}

export interface RunPythonAgentResult {
  session_id: string;
  result: string | null;
  plan: string[];
  reasoning: string;
  timeline: Array<{ label: string; kind: string; payload: unknown }>;
  tool_history: Array<Record<string, unknown>>;
  workspace_files: string[];
}

/**
 * Delegate a goal to the Python multi-agent graph (planner -> research /
 * browsing / coding / file). Pass sessionId to reuse the same persistent
 * workspace across multiple calls (e.g. within one chat thread); omit it
 * to get a fresh workspace.
 */
export async function runPythonAgent(
  goal: string,
  userId: string,
  threadId?: string,
  sessionId?: string,
): Promise<RunPythonAgentResult> {
  return callPythonService<RunPythonAgentResult>("/agent/run", {
    goal,
    user_id: userId,
    thread_id: threadId ?? null,
    session_id: sessionId ?? null,
  });
}

/** List files currently sitting in a session's Python-side workspace. */
export async function listPythonWorkspaceFiles(
  userId: string,
  sessionId: string,
): Promise<Array<{ path: string; bytes: number }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `${PYTHON_SERVICE_URL}/api/v1/workspace/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/files`,
      { headers: { "X-OpenAgent-Bridge-Token": PYTHON_SERVICE_TOKEN }, signal: controller.signal },
    );
    if (!res.ok) throw new PythonServiceError(`Workspace listing failed: ${res.status}`, res.status);
    return (await res.json()) as Array<{ path: string; bytes: number }>;
  } finally {
    clearTimeout(timeout);
  }
}

/** Semantic recall against the Python-side long-term memory store. */
export async function recallPythonMemory(
  userId: string,
  query: string,
  nResults = 5,
): Promise<Array<{ text: string; metadata: Record<string, unknown>; distance: number }>> {
  return callPythonService("/memory/recall", { user_id: userId, query, n_results: nResults }, 10_000);
}

/** Persist a fact/result into the Python-side long-term memory store. */
export async function rememberInPython(
  userId: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<{ id: string }> {
  return callPythonService("/memory/remember", { user_id: userId, text, metadata: metadata ?? null }, 10_000);
}

/** Health check — used to decide whether to expose the Python tools at all. */
export async function isPythonServiceHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${PYTHON_SERVICE_URL}/api/v1/health`, {
      headers: { "X-OpenAgent-Bridge-Token": PYTHON_SERVICE_TOKEN },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
