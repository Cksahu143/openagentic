/**
 * Browser controller — interface contract.
 * Real implementation lands in Milestone 4.
 */

export interface BrowserPageSnapshot {
  url: string;
  title: string;
  /** Simplified accessibility-tree-like representation. */
  outline: Array<{ role: string; name?: string; selector: string }>;
}

export interface BrowserController {
  open(url: string): Promise<void>;
  read(): Promise<BrowserPageSnapshot>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  uploadFile(selector: string, filePath: string): Promise<void>;
  download(url: string): Promise<{ path: string }>;
  newTab(url?: string): Promise<string>;
  closeTab(tabId: string): Promise<void>;
}

export const browser: BrowserController = {
  async open() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async read() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async click() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async fill() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async uploadFile() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async download() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async newTab() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
  async closeTab() { throw new Error("Browser module not implemented yet (Milestone 4)."); },
};
