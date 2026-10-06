import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("LocalStorage", () => {
  const dirPromise = mkdtemp(path.join(tmpdir(), "exquis-"));
  afterAll(async () => rm(await dirPromise, { recursive: true, force: true }));

  it("écrit, relit et signe", async () => {
    const s = new LocalStorage(await dirPromise, "s".repeat(32), "http://x");
    await s.put("games/1/a.png", Buffer.from("hello"), "image/png");
    expect((await s.get("games/1/a.png")).toString()).toBe("hello");
    expect(await s.exists("games/1/a.png")).toBe(true);
    expect(await s.exists("nope")).toBe(false);
    expect(await s.signedUrl("games/1/a.png", 300)).toMatch(/^http:\/\/x\/api\/storage\//);
  });
  it("refuse les clés qui sortent du dossier", async () => {
    const s = new LocalStorage(await dirPromise, "s".repeat(32), "http://x");
    await expect(s.put("../evil", Buffer.from("x"), "text/plain")).rejects.toThrow();
  });
});
