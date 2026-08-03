/**
 * Isolated JavaScript runner for planner and VM tools.
 *
 * QuickJS runs as a separate WebAssembly heap with no host APIs, filesystem,
 * network, process, or environment access. CPU and memory are bounded.
 */

import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

const TIMEOUT_MS = 5000;
const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

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

  try {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIMEOUT_MS));
    const vm = runtime.newContext();

    const consoleHandle = vm.newObject();
    for (const level of ["log", "warn", "error"] as const) {
      const fn = vm.newFunction(level, (...args) => {
        const line = args.map((arg) => stringify(vm.dump(arg))).join(" ");
        logs.push(level === "log" ? line : `[${level}] ${line}`);
      });
      vm.setProp(consoleHandle, level, fn);
      fn.dispose();
    }
    vm.setProp(vm.global, "console", consoleHandle);
    consoleHandle.dispose();

    const evaluated = vm.evalCode(`"use strict"; (() => { ${code}\n })()`);
    if (evaluated.error) {
      const dumped = vm.dump(evaluated.error);
      evaluated.error.dispose();
      vm.dispose();
      runtime.dispose();
      throw new Error(typeof dumped === "object" && dumped && "message" in dumped ? String(dumped.message) : stringify(dumped));
    }
    const result = vm.dump(evaluated.value);
    evaluated.value.dispose();
    vm.dispose();
    runtime.dispose();

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


