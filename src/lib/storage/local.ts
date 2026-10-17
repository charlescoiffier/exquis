import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./index";
import { signToken } from "./token";

export class LocalStorage implements Storage {
  private readonly root: string;
  /** `baseUrl` vide : URLs relatives, résolues par le navigateur sur l'adresse d'où la page est servie (localhost, IP du réseau local…). */
  constructor(dir: string, private readonly secret: string, private readonly baseUrl = "") {
    this.root = path.resolve(dir);
  }
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("clé de stockage invalide");
    return full;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async put(key: string, data: Buffer, _contentType?: string) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async get(key: string) { return readFile(this.resolve(key)); }
  async exists(key: string) {
    try { await stat(this.resolve(key)); return true; } catch { return false; }
  }
  async delete(key: string) { await rm(this.resolve(key), { force: true }); }
  async signedUrl(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.baseUrl}/api/storage/${signToken(key, exp, this.secret)}`;
  }
}
