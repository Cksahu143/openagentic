/**
 * Plugin system — interface contract. Milestone 7.
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  tools: Array<{ name: string; description: string; schema: unknown }>;
  requiredScopes: string[];
}

export interface PluginRuntime {
  install(manifest: PluginManifest): Promise<void>;
  uninstall(id: string): Promise<void>;
  list(): Promise<PluginManifest[]>;
  callTool(pluginId: string, toolName: string, args: unknown): Promise<unknown>;
}

export const plugins: PluginRuntime = {
  async install() { throw new Error("Plugin system not implemented yet (Milestone 7)."); },
  async uninstall() { throw new Error("Plugin system not implemented yet (Milestone 7)."); },
  async list() { return []; },
  async callTool() { throw new Error("Plugin system not implemented yet (Milestone 7)."); },
};
