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
