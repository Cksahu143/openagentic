/**
 * Tiny JS sandbox for the planner's run_code tool.
 *
 * Runs the snippet via `new Function` with a captured console and a hard
 * timeout via racing against a Promise. NOT a real isolate — this is fine for
 * small data-munging / quick computation, NOT for running untrusted user code
 * from the open internet.
 */

const TIMEOUT_MS = 5000;

export interface RunCodeResult {
  ok: boolean;
  result: string;
  logs: string[];
  error: string | null;
  elapsedMs: number;
}


export async function runJs(code: string): Promise<RunCodeResult> {
  const started = Date.now();
  const logs: string[] = [];
  const fakeConsole = {
    log: (...a: unknown[]) => logs.push(a.map(stringify).join(" ")),
    warn: (...a: unknown[]) => logs.push("[warn] " + a.map(stringify).join(" ")),
    error: (...a: unknown[]) => logs.push("[error] " + a.map(stringify).join(" ")),
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "console",
      `"use strict"; return (async () => { ${code}\n })();`,
    ) as (c: typeof fakeConsole) => Promise<unknown>;

    const result = await Promise.race([
      fn(fakeConsole),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);

    return {
      ok: true,
      result: stringify(result),
      logs,
      error: null,
      elapsedMs: Date.now() - started,
    };

  } catch (err) {
    return {
      ok: false,
      result: "",
      logs,

      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function safe(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
void safe;

