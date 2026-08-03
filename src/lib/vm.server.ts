/**
 * OpenAgent Virtual Machine — server-only.
 *
 * A lightweight virtual computer for the agent. It has:
 *   - A virtual file system (persisted to agent_vms.fs as JSONB)
 *   - A terminal command interpreter (ls, cat, echo, mkdir, etc.)
 *   - Code execution (JS via existing sandbox)
 *   - An "installed apps" system the main agent configures per sub-agent
 *
 * This is NOT a real Linux container — it's an in-process abstraction
 * that gives the agent a persistent, observable workspace. The user
 * watches it live through the Desktop UI.
 *
 * Do not import this file from client code.
 */
import { runJs } from "./code-runner.server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────

export interface VMSpec {
  cpu: string;
  memory: string;
  storage: string;
  gpu: string;
  os: string;
}

export interface VMFile {
  content: string;
  type: "file" | "dir";
  size: number;
  modified: string;
}

export type VFS = Record<string, VMFile>;

export interface TerminalEntry {
  command: string;
  output: string;
  timestamp: number;
  cwd: string;
}

export interface VMState {
  id: string;
  label: string;
  fs: VFS;
  cwd: string;
  terminalHistory: TerminalEntry[];
  installedApps: string[];
  spec: VMSpec;
  status: string;
}

// ── Path utilities ────────────────────────────────────────────

function normalizePath(cwd: string, path: string): string {
  if (path.startsWith("/")) {
    // absolute
    const parts = path.split("/").filter(Boolean);
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === "..") resolved.pop();
      else if (p !== ".") resolved.push(p);
    }
    return "/" + resolved.join("/");
  }
  // relative to cwd
  return normalizePath(cwd, `${cwd}/${path}`);
}

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// ── Default VM ───────────────────────────────────────────────

export const DEFAULT_SPEC: VMSpec = {
  cpu: "16 cores @ 3.8GHz",
  memory: "32GB RAM",
  storage: "500GB SSD",
  gpu: "24GB VRAM",
  os: "OpenAgent Linux 2026",
};

export const DEFAULT_APPS = [
  "terminal",
  "editor",
  "filesystem",
  "code-runner",
  "web-browser",
];

function defaultFS(): VFS {
  const now = new Date().toISOString();
  return {
    "/home": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent/Desktop": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent/Documents": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent/Downloads": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent/Projects": { content: "", type: "dir", size: 0, modified: now },
    "/home/agent/.bashrc": {
      content: '# OpenAgent shell config\nexport PS1="agent@vm:\\w$ "\n',
      type: "file",
      size: 52,
      modified: now,
    },
    "/home/agent/welcome.txt": {
      content:
        "Welcome to your OpenAgent Virtual Computer!\n\nThis is a persistent workspace. Files you create here survive across sessions.\nUse the terminal to run commands, the editor to write code, and the file browser to navigate.\n",
      type: "file",
      size: 180,
      modified: now,
    },
  };
}

// ── VM Database operations ────────────────────────────────────

export async function createVM(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  label = "Main Computer",
  apps: string[] = DEFAULT_APPS,
): Promise<VMState> {
  const { data, error } = await supabase
    .from("agent_vms")
    .insert({
      session_id: sessionId,
      user_id: userId,
      label,
      fs: defaultFS() as never,
      cwd: "/home/agent",
      installed_apps: apps,
      spec: DEFAULT_SPEC as never,
      status: "running",
    })
    .select("id, label, fs, cwd, terminal_history, installed_apps, spec, status")
    .single();

  if (error || !data) throw new Error(`Failed to create VM: ${error?.message ?? "unknown"}`);

  return rowToState(data);
}

export async function getVM(
  supabase: SupabaseClient,
  vmId: string,
): Promise<VMState | null> {
  const { data } = await supabase
    .from("agent_vms")
    .select("id, label, fs, cwd, terminal_history, installed_apps, spec, status")
    .eq("id", vmId)
    .maybeSingle();
  if (!data) return null;
  return rowToState(data);
}

export async function getVMBySession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<VMState | null> {
  const { data } = await supabase
    .from("agent_vms")
    .select("id, label, fs, cwd, terminal_history, installed_apps, spec, status")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return rowToState(data);
}

export async function ensureVM(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
): Promise<VMState> {
  if (sessionId) {
    const existing = await getVMBySession(supabase, sessionId);
    if (existing) return existing;
  }
  return createVM(supabase, userId, sessionId);
}

export async function saveVMState(
  supabase: SupabaseClient,
  vmId: string,
  patch: Partial<Pick<VMState, "fs" | "cwd" | "terminalHistory" | "installedApps" | "status" | "spec">>,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.fs) update.fs = patch.fs as never;
  if (patch.cwd) update.cwd = patch.cwd;
  if (patch.terminalHistory) update.terminal_history = patch.terminalHistory as never;
  if (patch.installedApps) update.installed_apps = patch.installedApps;
  if (patch.status) update.status = patch.status;
  if (patch.spec) update.spec = patch.spec as never;
  await supabase.from("agent_vms").update(update).eq("id", vmId);
}

function rowToState(row: Record<string, unknown>): VMState {
  return {
    id: row.id as string,
    label: row.label as string,
    fs: (row.fs as VFS) ?? {},
    cwd: (row.cwd as string) ?? "/home/agent",
    terminalHistory: (row.terminal_history as TerminalEntry[]) ?? [],
    installedApps: (row.installed_apps as string[]) ?? DEFAULT_APPS,
    spec: (row.spec as VMSpec) ?? DEFAULT_SPEC,
    status: (row.status as string) ?? "idle",
  };
}

// ── File operations ───────────────────────────────────────────

export async function vmWriteFile(
  supabase: SupabaseClient,
  vmId: string,
  fs: VFS,
  path: string,
  content: string,
): Promise<{ fs: VFS; ok: boolean }> {
  const full = normalizePath("/home/agent", path);
  const newFs = {
    ...fs,
    [full]: {
      content,
      type: "file" as const,
      size: content.length,
      modified: new Date().toISOString(),
    },
  };
  // Ensure parent dirs exist
  let p = parentPath(full);
  while (p && p !== "/" && !newFs[p]) {
    newFs[p] = { content: "", type: "dir", size: 0, modified: new Date().toISOString() };
    p = parentPath(p);
  }
  await saveVMState(supabase, vmId, { fs: newFs });
  return { fs: newFs, ok: true };
}

export function vmReadFile(fs: VFS, path: string): { ok: boolean; content?: string; error?: string } {
  const full = normalizePath("/home/agent", path);
  const file = fs[full];
  if (!file) return { ok: false, error: `No such file: ${path}` };
  if (file.type === "dir") return { ok: false, error: `${path} is a directory` };
  return { ok: true, content: file.content };
}

export function vmListFiles(fs: VFS, cwd: string, path?: string): { ok: boolean; entries?: Array<{ name: string; type: string; size: number }>; error?: string } {
  const target = path ? normalizePath(cwd, path) : cwd;
  const prefix = target === "/" ? "/" : target + "/";
  const entries: Array<{ name: string; type: string; size: number }> = [];
  const seen = new Set<string>();
  for (const [p, file] of Object.entries(fs)) {
    if (p === target) continue;
    if (p.startsWith(prefix)) {
      const rest = p.slice(prefix.length);
      if (!rest) continue;
      const name = rest.split("/")[0];
      if (!seen.has(name)) {
        seen.add(name);
        const fullPath = prefix + name;
        entries.push({
          name,
          type: fs[fullPath]?.type ?? "file",
          size: fs[fullPath]?.size ?? 0,
        });
      }
    }
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  return { ok: true, entries };
}

// ── Terminal command interpreter ─────────────────────────────

export async function vmExecuteCommand(
  supabase: SupabaseClient,
  vmId: string,
  state: VMState,
  command: string,
): Promise<{ output: string; state: VMState }> {
  const cmd = command.trim();
  if (!cmd) return { output: "", state };

  const [name, ...args] = cmd.split(/\s+/);
  const cwd = state.cwd;
  const fs = state.fs;
  let output = "";
  let newCwd = cwd;
  let newFs = fs;

  switch (name) {
    case "pwd":
      output = cwd;
      break;

    case "ls": {
      const target = args[0] ? normalizePath(cwd, args[0]) : cwd;
      const result = vmListFiles(fs, target, undefined);
      if (result.ok && result.entries) {
        if (result.entries.length === 0) {
          output = "";
        } else {
          output = result.entries
            .map((e) => (e.type === "dir" ? `\x1b[34m${e.name}/\x1b[0m` : e.name))
            .join("  ");
        }
      } else {
        output = `ls: ${args[0] ?? ""}: No such file or directory`;
      }
      break;
    }

    case "cd": {
      const target = args[0] ? normalizePath(cwd, args[0]) : "/home/agent";
      if (fs[target] && fs[target].type === "dir") {
        newCwd = target;
      } else if (target === "/") {
        newCwd = "/";
      } else {
        output = `cd: ${args[0]}: No such file or directory`;
      }
      break;
    }

    case "cat": {
      if (!args[0]) {
        output = "cat: missing operand";
      } else {
        const result = vmReadFile(fs, args[0]);
        output = result.ok ? result.content ?? "" : result.error ?? "error";
      }
      break;
    }

    case "echo":
      output = args.join(" ").replace(/^["']|["']$/g, "");
      break;

    case "cp": {
      if (!args[0] || !args[1]) {
        output = "Usage: cp <source> <destination>";
      } else {
        const source = normalizePath(cwd, args[0]);
        const destination = normalizePath(cwd, args[1]);
        const file = fs[source];
        if (!file || file.type !== "file") output = `cp: ${args[0]}: No such file`;
        else {
          newFs = { ...fs, [destination]: { ...file, modified: new Date().toISOString() } };
          await saveVMState(supabase, vmId, { fs: newFs });
        }
      }
      break;
    }

    case "mv": {
      if (!args[0] || !args[1]) {
        output = "Usage: mv <source> <destination>";
      } else {
        const source = normalizePath(cwd, args[0]);
        const destination = normalizePath(cwd, args[1]);
        const file = fs[source];
        if (!file) output = `mv: ${args[0]}: No such file`;
        else {
          newFs = { ...fs, [destination]: { ...file, modified: new Date().toISOString() } };
          delete newFs[source];
          await saveVMState(supabase, vmId, { fs: newFs });
        }
      }
      break;
    }

    case "mkdir": {
      if (!args[0]) {
        output = "mkdir: missing operand";
      } else {
        const target = normalizePath(cwd, args[0]);
        newFs = {
          ...fs,
          [target]: { content: "", type: "dir", size: 0, modified: new Date().toISOString() },
        };
        await saveVMState(supabase, vmId, { fs: newFs });
      }
      break;
    }

    case "touch": {
      if (!args[0]) {
        output = "touch: missing operand";
      } else {
        const target = normalizePath(cwd, args[0]);
        if (!newFs[target]) {
          newFs = {
            ...fs,
            [target]: { content: "", type: "file", size: 0, modified: new Date().toISOString() },
          };
          await saveVMState(supabase, vmId, { fs: newFs });
        }
      }
      break;
    }

    case "rm": {
      const target = normalizePath(cwd, args[args[0] === "-rf" || args[0] === "-r" ? 1 : 0] ?? "");
      if (target && newFs[target]) {
        const filtered: VFS = {};
        for (const [p, f] of Object.entries(newFs)) {
          if (p !== target && !p.startsWith(target + "/")) filtered[p] = f;
        }
        newFs = filtered;
        await saveVMState(supabase, vmId, { fs: newFs });
      } else {
        output = `rm: ${args[0] ?? ""}: No such file or directory`;
      }
      break;
    }

    case "write": {
      // write <path> <content...>
      if (!args[0]) {
        output = "write: missing file path";
      } else {
        const filePath = args[0];
        const content = args.slice(1).join(" ");
        const res = await vmWriteFile(supabase, vmId, newFs, filePath, content);
        newFs = res.fs;
      }
      break;
    }

    case "head": {
      if (!args[0]) {
        output = "head: missing operand";
      } else {
        const result = vmReadFile(fs, args[0]);
        if (result.ok) {
          const lines = (result.content ?? "").split("\n").slice(0, 10);
          output = lines.join("\n");
        } else {
          output = result.error ?? "error";
        }
      }
      break;
    }

    case "tail": {
      if (!args[0]) {
        output = "tail: missing operand";
      } else {
        const result = vmReadFile(fs, args[0]);
        if (result.ok) {
          const lines = (result.content ?? "").split("\n").slice(-10);
          output = lines.join("\n");
        } else {
          output = result.error ?? "error";
        }
      }
      break;
    }

    case "wc": {
      if (!args[0]) {
        output = "wc: missing operand";
      } else {
        const result = vmReadFile(fs, args[0]);
        if (result.ok) {
          const content = result.content ?? "";
          const lines = content.split("\n").length;
          const words = content.split(/\s+/).filter(Boolean).length;
          const chars = content.length;
          output = `${lines} ${words} ${chars} ${args[0]}`;
        } else {
          output = result.error ?? "error";
        }
      }
      break;
    }

    case "date":
      output = new Date().toString();
      break;

    case "whoami":
      output = "agent";
      break;

    case "uname":
      output = args[0] === "-a"
        ? "OpenAgent Linux 2026 6.1.0-agent #1 SMP x86_64 GNU/Linux"
        : "OpenAgent Linux";
      break;

    case "clear":
      output = "\x1b[2J\x1b[H";
      break;

    case "help":
      output = [
        "OpenAgent Virtual Terminal — available commands:",
        "  pwd, ls, cd, cat, echo, mkdir, touch, rm, cp, mv, write, head, tail, wc",
        "  date, whoami, uname, clear, help, neofetch, tree, find, grep",
        "  run js <code>       — execute JavaScript in the sandbox",
        "  runfile <path>      — execute a JavaScript file",
        "  preview <path>      — mark an HTML file as the current preview",
        "  profile [linux|windows|macos] — select shell compatibility profile",
        "  apps                — list installed apps",
      ].join("\n");
      break;

    case "neofetch":
      output = formatNeofetch(state);
      break;

    case "tree": {
      const target = args[0] ? normalizePath(cwd, args[0]) : cwd;
      output = formatTree(fs, target, "", 3);
      break;
    }

    case "find": {
      const pattern = args[0] ?? "";
      const matches: string[] = [];
      for (const p of Object.keys(fs)) {
        if (!pattern || p.includes(pattern)) matches.push(p);
      }
      output = matches.length > 0 ? matches.join("\n") : "No files found";
      break;
    }

    case "grep": {
      const pattern = args[0] ?? "";
      const file = args[1] ?? "";
      if (!pattern || !file) {
        output = "Usage: grep <pattern> <file>";
      } else {
        const result = vmReadFile(fs, file);
        if (result.ok) {
          const lines = (result.content ?? "").split("\n");
          const matched = lines.filter((l) => l.includes(pattern));
          output = matched.length > 0 ? matched.join("\n") : "";
        } else {
          output = result.error ?? "error";
        }
      }
      break;
    }

    case "apps":
      output = `Installed apps:\n${state.installedApps.map((a) => `  • ${a}`).join("\n")}`;
      break;

    case "which": {
      const known = new Set(["pwd", "ls", "cd", "cat", "echo", "mkdir", "touch", "rm", "cp", "mv", "write", "head", "tail", "wc", "date", "whoami", "uname", "clear", "help", "neofetch", "tree", "find", "grep", "apps", "run", "runfile", "preview", "profile"]);
      output = args[0] && known.has(args[0]) ? `/usr/bin/${args[0]}` : "";
      break;
    }

    case "stat": {
      const target = normalizePath(cwd, args[0] ?? "");
      const file = fs[target];
      output = file
        ? `File: ${target}\nType: ${file.type}\nSize: ${file.size}\nModified: ${file.modified}`
        : `stat: ${args[0] ?? ""}: No such file`;
      break;
    }

    case "profile": {
      const profile = (args[0] ?? "").toLowerCase();
      const names: Record<string, string> = {
        linux: "OpenAgent Linux compatibility workspace",
        windows: "OpenAgent Windows compatibility workspace",
        macos: "OpenAgent macOS compatibility workspace",
      };
      if (!profile) output = state.spec.os;
      else if (!names[profile]) output = "profile: choose linux, windows, or macos";
      else {
        const spec = { ...state.spec, os: names[profile] };
        state.spec = spec;
        await saveVMState(supabase, vmId, { spec });
        output = `Switched to ${names[profile]}. This changes shell conventions and presentation; it is not a hosted native OS.`;
      }
      break;
    }

    case "preview": {
      const target = normalizePath(cwd, args[0] ?? "index.html");
      const file = fs[target];
      output = file?.type === "file"
        ? `Preview ready: ${target}`
        : `preview: ${args[0] ?? "index.html"}: No such file`;
      break;
    }

    case "runfile": {
      const target = normalizePath(cwd, args[0] ?? "");
      const file = fs[target];
      if (!file || file.type !== "file") output = `runfile: ${args[0] ?? ""}: No such file`;
      else {
        const result = await runJs(file.content);
        output = result.ok
          ? [...result.logs, result.result ? `=> ${result.result}` : ""].filter(Boolean).join("\n")
          : result.error ?? "execution error";
      }
      break;
    }

    case "run": {
      const lang = args[0] ?? "js";
      const code = args.slice(1).join(" ");
      if (!code) {
        output = "run: no code provided. Usage: run js <code>";
      } else {
        try {
          const result = await runJs(code);
          output = result.ok
            ? result.logs.join("\n") + (result.result ? `\n=> ${result.result}` : "")
            : result.error ?? "execution error";
        } catch (e) {
          output = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      break;
    }

    default:
      // Try to read as a file (like `./script.sh`)
      if (name.startsWith("./") || name.startsWith("/")) {
        const result = vmReadFile(fs, name);
        if (result.ok) {
          output = result.content ?? "";
        } else {
          output = `command not found: ${name}`;
        }
      } else {
        output = `command not found: ${name}. Type 'help' for available commands.`;
      }
  }

  // Persist terminal history
  const entry: TerminalEntry = {
    command: cmd,
    output: output.slice(0, 5000),
    timestamp: Date.now(),
    cwd,
  };
  const history = [...state.terminalHistory, entry].slice(-200);
  await saveVMState(supabase, vmId, { terminalHistory: history, cwd: newCwd });

  return {
    output,
    state: { ...state, fs: newFs, cwd: newCwd, terminalHistory: history },
  };
}

function formatNeofetch(state: VMState): string {
  const spec = state.spec;
  const apps = state.installedApps;
  return [
    "\x1b[36m    ___                          \x1b[0m  \x1b[1magent@openagent-vm\x1b[0m",
    "\x1b[36m   /   |  _______ _____  ____  \x1b[0m  ─────────────────────",
    "\x1b[36m  / /| | / ___/ //_/ _ \\/ __ \\ \x1b[0m  \x1b[33mOS:\x1b[0m     " + spec.os,
    "\x1b[36m / ___ |/ /__/ ,< /  __/ / / / \x1b[0m  \x1b[33mKernel:\x1b[0m 6.1.0-agent",
    "\x1b[36m/_/  |_|\\___/_/|_|\\___/_/ /_/  \x1b[0m  \x1b[33mCPU:\x1b[0m     " + spec.cpu,
    "                                \x1b[33mMemory:\x1b[0m  " + spec.memory,
    "                                \x1b[33mDisk:\x1b[0m    " + spec.storage,
    "                                \x1b[33mGPU:\x1b[0m     " + spec.gpu,
    "                                \x1b[33mApps:\x1b[0m    " + apps.join(", "),
  ].join("\n");
}

function formatTree(fs: VFS, base: string, indent: string, maxDepth: number): string {
  if (maxDepth <= 0) return "";
  const result = vmListFiles(fs, base, undefined);
  if (!result.ok || !result.entries) return "";
  let out = "";
  for (const e of result.entries) {
    const isLast = e === result.entries[result.entries.length - 1];
    const prefix = indent + (isLast ? "└── " : "├── ");
    out += prefix + (e.type === "dir" ? `\x1b[34m${e.name}/\x1b[0m` : e.name) + "\n";
    if (e.type === "dir") {
      out += formatTree(fs, base + "/" + e.name, indent + (isLast ? "    " : "│   "), maxDepth - 1);
    }
  }
  return out;
}

// ── App registry ─────────────────────────────────────────────

export const APP_REGISTRY: Record<string, { name: string; description: string; tools: string[] }> = {
  terminal: { name: "Terminal", description: "Shell command interpreter", tools: ["vm_terminal"] },
  editor: { name: "Code Editor", description: "Write and edit source files", tools: ["vm_write_file", "vm_read_file"] },
  filesystem: { name: "File Manager", description: "Browse and manage files", tools: ["vm_write_file", "vm_read_file", "vm_list_files"] },
  "code-runner": { name: "Code Runner", description: "Execute JS/Python code", tools: ["vm_run_code"] },
  "web-browser": { name: "Web Browser", description: "Fetch URLs and read pages", tools: ["fetch_url"] },
  "ai-brain": { name: "AI Brain", description: "Delegate to another AI model", tools: ["ask_ai"] },
  "researcher": { name: "Researcher", description: "Web research and summarization", tools: ["fetch_url", "ask_ai"] },
  "writer": { name: "Writer", description: "Document generation", tools: ["vm_write_file", "vm_read_file"] },
  "analyst": { name: "Data Analyst", description: "Run code on data", tools: ["vm_run_code", "vm_read_file"] },
};

export function getAppTools(apps: string[]): string[] {
  const tools = new Set<string>();
  for (const app of apps) {
    const entry = APP_REGISTRY[app];
    if (entry) entry.tools.forEach((t) => tools.add(t));
  }
  return Array.from(tools);
}
