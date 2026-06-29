/**
 * File manager module — interface contract. Milestone 5.
 */

export interface FileEntry {
  path: string;
  size: number;
  mimeType?: string;
  updatedAt: string;
}

export interface FileManager {
  list(prefix: string): Promise<FileEntry[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export const files: FileManager = {
  async list() { return []; },
  async read() { throw new Error("File module not implemented yet (Milestone 5)."); },
  async write() { throw new Error("File module not implemented yet (Milestone 5)."); },
  async remove() { throw new Error("File module not implemented yet (Milestone 5)."); },
};
