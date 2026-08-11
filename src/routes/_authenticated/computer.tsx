import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  browseInVirtualComputer,
  openVirtualComputerApp,
  runVirtualComputerCommand,
  startVirtualComputer,
} from "@/lib/vm.functions";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@tanstack/react-router";
import {
  Monitor, Terminal, Folder, Cpu, MemoryStick, HardDrive, Bot, Send,
  Globe, ArrowRight, Loader2, AppWindow, Eye, Download,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/computer")({
  head: () => ({
    title: "Agent Computer — OpenAgent",
    meta: [
      { name: "description", content: "Live view of the OpenAgent computer, terminal, browser, source files, previews, and sub-agents." },
      { property: "og:title", content: "Agent Computer — OpenAgent" },
      { property: "og:description", content: "Watch OpenAgent work in its computer with a browser, files, terminal activity, and sub-agents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComputerPage,
});

interface VMRow {
  id: string;
  label: string;
  cwd: string;
  fs: Record<string, { content: string; type: string; size: number }>;
  terminal_history: Array<{ command: string; output: string; timestamp: number; cwd: string }>;
  installed_apps: string[];
  spec: { cpu: string; memory: string; storage: string; gpu: string; os: string };
  status: string;
  updated_at: string;
}

interface SubAgentRow {
  id: string;
  name: string;
  goal: string;
  status: string;
  allowed_apps: string[];
  result: { text?: string } | null;
  created_at: string;
}

interface BrowserPage {
  url: string;
  status: number;
  title: string | null;
  text: string;
  links: Array<{ href: string; text: string }>;
}

/** Apps the user can launch/install from the desktop bar. */
const INSTALLABLE_APPS = [
  "web-browser", "editor", "code-runner", "filesystem", "node", "bun", "deno",
  "python3", "typescript", "git", "curl", "sqlite3", "ffmpeg",
];

type Pane = "terminal" | "browser" | "preview";

function ComputerPage() {
  const hydrated = useHydrated();
  const startComputer = useServerFn(startVirtualComputer);
  const runComputerCommand = useServerFn(runVirtualComputerCommand);
  const browseComputer = useServerFn(browseInVirtualComputer);
  const openApp = useServerFn(openVirtualComputerApp);
  const [vms, setVms] = useState<VMRow[]>([]);
  const [activeVM, setActiveVM] = useState<VMRow | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgentRow[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [pane, setPane] = useState<Pane>("terminal");
  const [urlInput, setUrlInput] = useState("");
  const [page, setPage] = useState<BrowserPage | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  const loadVMs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("agent_vms")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) {
      setVms(data as unknown as VMRow[]);
      if (data.length > 0 && !activeVM) {
        setActiveVM(data[0] as unknown as VMRow);
        const vm = data[0] as unknown as VMRow;
        setTerminalOutput(
          (vm.terminal_history ?? []).map(
            (e) => `agent@vm:${e.cwd}$ ${e.command}\n${e.output}`,
          ),
        );
      }
    }
    setLoading(false);
  }, [activeVM]);

  const loadSubAgents = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("sub_agents")
      .select("id, name, goal, status, allowed_apps, result, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setSubAgents(data as unknown as SubAgentRow[]);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    loadVMs();
    loadSubAgents();

    const vmChannel = supabase
      .channel("agent_vms_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_vms" }, () => loadVMs())
      .subscribe();
    const subChannel = supabase
      .channel("sub_agents_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sub_agents" }, () => loadSubAgents())
      .subscribe();

    return () => {
      supabase.removeChannel(vmChannel);
      supabase.removeChannel(subChannel);
    };
  }, [hydrated, loadVMs, loadSubAgents]);

  const runTerminalCommand = async () => {
    if (!terminalInput.trim() || !activeVM) return;
    const cmd = terminalInput;
    setTerminalInput("");
    setTerminalOutput((prev) => [...prev, `agent@vm:${activeVM.cwd}$ ${cmd}`]);
    try {
      const result = await runComputerCommand({ data: { vmId: activeVM.id, command: cmd } });
      setTerminalOutput((prev) => [...prev, result.output]);
    } catch (error) {
      setTerminalOutput((prev) => [...prev, error instanceof Error ? error.message : String(error)]);
    }
    await loadVMs();
  };

  const visit = async (raw: string) => {
    if (!activeVM || !raw.trim()) return;
    setPane("browser");
    setBrowserBusy(true);
    setBrowserError(null);
    try {
      const result = await browseComputer({ data: { vmId: activeVM.id, url: raw.trim() } });
      if (result.ok) {
        setPage({
          url: result.url,
          status: result.status,
          title: result.title,
          text: result.text,
          links: result.links,
        });
        setUrlInput(result.url);
      } else {
        setBrowserError(result.error);
      }
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowserBusy(false);
      loadVMs();
    }
  };

  const launchApp = async (app: string) => {
    if (!activeVM) return;
    setLaunching(app);
    try {
      const result = await openApp({ data: { vmId: activeVM.id, app } });
      setTerminalOutput((prev) => [...prev, `agent@vm:${activeVM.cwd}$ open ${app}`, result.output]);
      if (app === "web-browser") setPane("browser");
      else setPane("terminal");
    } catch (error) {
      setTerminalOutput((prev) => [...prev, error instanceof Error ? error.message : String(error)]);
    } finally {
      setLaunching(null);
      await loadVMs();
    }
  };

  const bootComputer = async () => {
    setLoading(true);
    try {
      const vm = await startComputer();
      setVms([vm as unknown as VMRow]);
      setActiveVM(vm as unknown as VMRow);
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground font-mono text-sm">Booting agent computer…</div>
      </div>
    );
  }

  if (vms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Monitor className="h-16 w-16 text-muted-foreground/50" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">No agent computer yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Enable Virtual Computer in Permissions, then start the isolated workspace.
          </p>
        </div>
        <Button onClick={bootComputer}>Start computer</Button>
      </div>
    );
  }

  const spec = activeVM?.spec ?? { cpu: "", memory: "", storage: "", gpu: "", os: "" };
  const files = activeVM?.fs ?? {};
  const filePaths = Object.keys(files).sort();
  const htmlFiles = filePaths.filter((p) => p.endsWith(".html") || p.endsWith(".htm"));
  const activePreview = previewPath ?? htmlFiles[0] ?? null;

  return (
    <div className="flex flex-col h-full gap-3 p-3">
      {/* VM selector + spec bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={activeVM?.id ?? ""}
          onChange={(e) => {
            const vm = vms.find((v) => v.id === e.target.value);
            if (vm) {
              setActiveVM(vm);
              setTerminalOutput(
                (vm.terminal_history ?? []).map(
                  (e) => `agent@vm:${e.cwd}$ ${e.command}\n${e.output}`,
                ),
              );
            }
          }}
          className="bg-card border border-border rounded-md px-3 py-1.5 text-sm font-mono"
        >
          {vms.map((vm) => (
            <option key={vm.id} value={vm.id}>{vm.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
          <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {spec.cpu}</span>
          <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" /> {spec.memory}</span>
          <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {spec.storage}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${activeVM?.status === "running" ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"}`} />
          <span className="text-xs font-mono text-muted-foreground">{activeVM?.status ?? "idle"}</span>
        </div>
      </div>

      {/* App launcher / dock */}
      <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-card/50 px-3 py-2">
        <AppWindow className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mr-1">apps</span>
        {INSTALLABLE_APPS.map((app) => {
          const installed = activeVM?.installed_apps.includes(app);
          return (
            <button
              key={app}
              onClick={() => launchApp(app)}
              disabled={launching === app}
              title={installed ? `Open ${app}` : `Install & open ${app}`}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                installed
                  ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {launching === app ? "…" : installed ? app : `+ ${app}`}
            </button>
          );
        })}
      </div>

      {/* Main grid: terminal/browser/preview | file explorer | sub-agents */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_280px] gap-3 flex-1 min-h-0">
        {/* Pane host */}
        <div className="flex flex-col rounded-lg border border-border bg-black/80 overflow-hidden min-h-0">
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card/50">
            {([
              { id: "terminal" as const, label: "terminal", icon: Terminal },
              { id: "browser" as const, label: "browser", icon: Globe },
              { id: "preview" as const, label: "preview", icon: Eye },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setPane(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  pane === id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
            <span className="ml-auto text-[10px] font-mono text-muted-foreground truncate max-w-[40%]">
              {pane === "terminal" ? activeVM?.cwd : pane === "browser" ? page?.url ?? "about:blank" : activePreview ?? "no html file"}
            </span>
          </div>

          {pane === "terminal" && (
            <>
              <div className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
                {terminalOutput.length === 0 ? (
                  <div className="text-muted-foreground/50">Waiting for agent activity…</div>
                ) : (
                  terminalOutput.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap text-green-400/90">{line}</div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
                <span className="text-xs font-mono text-green-500">agent@vm:{activeVM?.cwd ?? "~"}$</span>
                <input
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runTerminalCommand()}
                  placeholder="type a command… (try: browse example.com)"
                  className="flex-1 bg-transparent text-xs font-mono text-green-400 outline-none placeholder:text-muted-foreground/40"
                />
                <Send className="h-3 w-3 text-muted-foreground cursor-pointer" onClick={runTerminalCommand} />
              </div>
            </>
          )}

          {pane === "browser" && (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/30">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && visit(urlInput)}
                  placeholder="https://example.com"
                  className="flex-1 bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground/40"
                />
                <button
                  onClick={() => visit(urlInput)}
                  disabled={browserBusy}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  aria-label="Visit URL"
                >
                  {browserBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 text-xs">
                {browserError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive font-mono">
                    {browserError}
                  </div>
                )}
                {!browserError && !page && (
                  <div className="text-muted-foreground/60 font-mono">
                    The VM browser is a reader-mode web client. Enter a URL above, or run
                    <span className="text-primary"> browse &lt;url&gt;</span> in the terminal. Snapshots are
                    saved to /home/agent/Downloads/browser-last.md.
                  </div>
                )}
                {page && (
                  <div className="space-y-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{page.title ?? page.url}</h2>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        HTTP {page.status} · {page.url}
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-foreground/80 leading-relaxed">
                      {page.text.slice(0, 20000)}
                    </pre>
                    {page.links.length > 0 && (
                      <div className="border-t border-border pt-2">
                        <div className="text-[10px] font-mono text-muted-foreground mb-1 flex items-center gap-1">
                          <Download className="h-3 w-3" /> links ({page.links.length})
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {page.links.slice(0, 40).map((l, i) => (
                            <button
                              key={`${l.href}-${i}`}
                              onClick={() => visit(l.href)}
                              className="text-left text-[11px] text-primary hover:underline truncate"
                            >
                              {l.text || l.href}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {pane === "preview" && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/30 overflow-x-auto">
                {htmlFiles.length === 0 ? (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    No .html file in the VM yet — the agent can create one with vm_write_file.
                  </span>
                ) : (
                  htmlFiles.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPreviewPath(p)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                        activePreview === p
                          ? "bg-primary/15 text-primary border-primary/20"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {p.split("/").pop()}
                    </button>
                  ))
                )}
              </div>
              <div className="flex-1 bg-white">
                {activePreview && (
                  <iframe
                    title={`Preview of ${activePreview}`}
                    srcDoc={files[activePreview]?.content ?? ""}
                    sandbox="allow-scripts"
                    className="w-full h-full border-0"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* File Explorer */}
        <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Folder className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground">files</span>
          </div>
          <div className="flex-1 overflow-auto">
            {filePaths.map((path) => (
              <button
                key={path}
                onClick={() => {
                  setSelectedPath(path);
                  setFileContent(files[path]?.content ?? "");
                  if (path.endsWith(".html") || path.endsWith(".htm")) {
                    setPreviewPath(path);
                    setPane("preview");
                  }
                }}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-primary/10 transition-colors truncate ${
                  selectedPath === path ? "bg-primary/15 text-primary" : ""
                }`}
              >
                <span className={files[path]?.type === "dir" ? "text-blue-400" : "text-muted-foreground"}>
                  {files[path]?.type === "dir" ? "📁 " : "📄 "}
                </span>
                {path}
              </button>
            ))}
          </div>
          {selectedPath && fileContent && (
            <div className="border-t border-border max-h-48 overflow-auto p-2">
              <div className="text-[10px] font-mono text-muted-foreground mb-1">{selectedPath}</div>
              <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">{fileContent.slice(0, 2000)}</pre>
            </div>
          )}
        </div>

        {/* Sub-Agents */}
        <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground">sub-agents ({subAgents.length})</span>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {subAgents.length === 0 ? (
              <div className="text-xs text-muted-foreground/50 text-center py-4">
                No sub-agents spawned yet.
              </div>
            ) : (
              subAgents.map((sa) => (
                <div key={sa.id} className="rounded-md border border-border p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      sa.status === "completed" ? "bg-green-500" :
                      sa.status === "running" ? "bg-yellow-500 animate-pulse" :
                      "bg-muted-foreground/30"
                    }`} />
                    <span className="font-mono font-semibold">{sa.name}</span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">{sa.goal.slice(0, 100)}</div>
                  <div className="flex flex-wrap gap-1">
                    {sa.allowed_apps.map((a) => (
                      <span key={a} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-mono">{a}</span>
                    ))}
                  </div>
                  {sa.result?.text && (
                    <div className="text-[10px] text-muted-foreground/70 border-t border-border pt-1 mt-1">
                      {sa.result.text.slice(0, 150)}…
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
