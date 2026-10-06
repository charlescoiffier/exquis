import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/errors";

const requireUser = vi.fn();
vi.mock("@/lib/session", () => ({ requireUser: () => requireUser() }));

import { parseId, route } from "@/lib/api";

const ctx = { params: Promise.resolve({}) };
const req = new Request("http://x/");
let n = 0;

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: "u1" });
});

describe("route()", () => {
  it("non authentifié -> 401", async () => {
    requireUser.mockRejectedValue(new DomainError("unauthorized", "Connexion requise.", 401));
    const res = await route(async () => requireUser())(req, ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });
  it("objet -> 200 JSON ; Response -> passe telle quelle", async () => {
    const a = await route(async () => ({ ok: true }))(req, ctx);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
    const r = new Response("x", { status: 201 });
    expect(await route(async () => r)(req, ctx)).toBe(r);
  });
  it("DomainError -> son statut", async () => {
    const res = await route(async () => {
      throw new DomainError("game_full", "Complète", 409);
    })(req, ctx);
    expect(res.status).toBe(409);
  });
  it("limite : (max+1)-ième appel -> 429, autre utilisateur épargné", async () => {
    const h = route(async () => ({ ok: true }), { limit: { name: `t${++n}`, max: 2, windowMs: 60_000 } });
    expect((await h(req, ctx)).status).toBe(200);
    expect((await h(req, ctx)).status).toBe(200);
    const res = await h(req, ctx);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("rate_limited");
    requireUser.mockResolvedValue({ id: "u2" });
    expect((await h(req, ctx)).status).toBe(200);
  });
  it("l'authentification précède la limite et le handler", async () => {
    requireUser.mockRejectedValue(new DomainError("unauthorized", "Connexion requise.", 401));
    const handler = vi.fn(async () => ({}));
    const h = route(handler, { limit: { name: `t${++n}`, max: 1, windowMs: 60_000 } });
    expect((await h(req, ctx)).status).toBe(401);
    expect((await h(req, ctx)).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("parseId", () => {
  it("accepte un UUID, refuse le reste en 404", async () => {
    const id = "9d56ee4c-a4e7-4852-984f-481ffc74c0ac";
    expect(await parseId({ params: Promise.resolve({ id }) })).toBe(id);
    await expect(parseId({ params: Promise.resolve({ id: "nope" }) })).rejects.toMatchObject({ status: 404 });
  });
});
