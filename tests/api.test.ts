import { describe, expect, it } from "vitest";
import { toErrorResponse } from "@/lib/api";
import { DomainError } from "@/lib/errors";

describe("toErrorResponse", () => {
  it("convertit une DomainError en réponse JSON avec son statut", async () => {
    const res = toErrorResponse(new DomainError("game_full", "Complète", 409));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Complète", code: "game_full" });
  });
  it("masque les erreurs inconnues", async () => {
    const res = toErrorResponse(new Error("secret"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

import { readBodyLimited, readJson, readTokenBody } from "@/lib/api";

describe("readJson", () => {
  const mk = (body?: string) => new Request("http://x/", { method: "POST", body });
  it("parse un JSON valide", async () => {
    expect(await readJson(mk('{"a":1}'))).toEqual({ a: 1 });
  });
  it("corps vide : {} si autorisé, sinon 400", async () => {
    expect(await readJson(mk(), { allowEmpty: true })).toEqual({});
    await expect(readJson(mk())).rejects.toMatchObject({ code: "invalid_json", status: 400 });
  });
  it("JSON malformé -> 400 invalid_json", async () => {
    await expect(readJson(mk("{oops"))).rejects.toMatchObject({ code: "invalid_json", status: 400 });
  });
  it("readTokenBody : vide ok, null ok, token non-string refusé", async () => {
    expect(await readTokenBody(mk())).toEqual({});
    expect(await readTokenBody(mk("null"))).toEqual({});
    expect(await readTokenBody(mk('{"token":"t"}'))).toEqual({ token: "t" });
    await expect(readTokenBody(mk('{"token":5}'))).rejects.toMatchObject({ status: 400 });
    await expect(readTokenBody(mk("{x"))).rejects.toMatchObject({ status: 400 });
  });
});

describe("readBodyLimited", () => {
  const streamOf = (chunks: number[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const n of chunks) c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
  const mk = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit);
  it("lit un corps sous la limite (sans content-length)", async () => {
    expect((await readBodyLimited(mk(streamOf([10, 10])), 100)).length).toBe(20);
  });
  it("coupe un flux dépassant la limite sans content-length", async () => {
    await expect(readBodyLimited(mk(streamOf([60, 60])), 100)).rejects.toMatchObject({ status: 413 });
  });
  it("refuse un content-length déclaré trop grand ou invalide", async () => {
    await expect(readBodyLimited(mk(streamOf([1]), { "content-length": "999" }), 100)).rejects.toMatchObject({ status: 413 });
    await expect(readBodyLimited(mk(streamOf([1]), { "content-length": "abc" }), 100)).rejects.toMatchObject({ status: 400 });
  });
});
