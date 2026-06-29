/**
 * Local Companion bridge — interface contract.
 *
 * The companion is an optional desktop program the user installs voluntarily.
 * The web app talks to it over a signed local channel (e.g. wss://127.0.0.1
 * with a per-device token). Real implementation lands in Milestone 6.
 */

export interface CompanionStatus {
  connected: boolean;
  version?: string;
  os?: "macos" | "windows" | "linux";
}

export interface CompanionBridge {
  status(): Promise<CompanionStatus>;
  pair(code: string): Promise<{ deviceId: string }>;
  openApp(name: string): Promise<void>;
  readAccessibilityTree(): Promise<unknown>;
  keyboardInput(text: string): Promise<void>;
  mouseClick(x: number, y: number): Promise<void>;
  listWindows(): Promise<Array<{ id: string; title: string }>>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export const companion: CompanionBridge = {
  async status() { return { connected: false }; },
  async pair() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async openApp() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async readAccessibilityTree() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async keyboardInput() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async mouseClick() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async listWindows() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async readFile() { throw new Error("Companion not implemented yet (Milestone 6)."); },
  async writeFile() { throw new Error("Companion not implemented yet (Milestone 6)."); },
};
