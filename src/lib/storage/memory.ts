import type { Storage } from "./index";

export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async put(key: string, data: Buffer, _contentType?: string) { this.files.set(key, data); }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error(`absent: ${key}`);
    return f;
  }
  async exists(key: string) { return this.files.has(key); }
  async signedUrl(key: string) { return `memory://${key}`; }
}
