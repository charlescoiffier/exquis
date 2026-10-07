import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS, canActOnTurn, canViewFinal } from "@/lib/access";

const t0 = new Date("2026-01-01T00:00:00Z");
const deadline = new Date(t0.getTime() + 60_000);
const turn = { assignedUserId: "u1", status: "active", deadline };

describe("canActOnTurn", () => {
  it("la tolérance de validation est de 60 s", () => expect(SUBMIT_GRACE_MS).toBe(60_000));
  it("accepte le joueur assigné avant l'échéance", () => expect(canActOnTurn(turn, "u1", t0)).toBe(true));
  it("accepte dans la tolérance", () => expect(canActOnTurn(turn, "u1", new Date(deadline.getTime() + SUBMIT_GRACE_MS))).toBe(true));
  it("refuse après la tolérance", () => expect(canActOnTurn(turn, "u1", new Date(deadline.getTime() + SUBMIT_GRACE_MS + 1))).toBe(false));
  it("refuse un autre joueur", () => expect(canActOnTurn(turn, "u2", t0)).toBe(false));
  it("refuse un tour non actif", () => expect(canActOnTurn({ ...turn, status: "done" }, "u1", t0)).toBe(false));
});

describe("canViewFinal", () => {
  it("participant d'une partie terminée seulement", () => {
    expect(canViewFinal({ status: "completed" }, ["u1"], "u1")).toBe(true);
    expect(canViewFinal({ status: "in_progress" }, ["u1"], "u1")).toBe(false);
    expect(canViewFinal({ status: "completed" }, ["u1"], "u2")).toBe(false);
    expect(canViewFinal({ status: "open" }, ["u1"], "u1")).toBe(false);
  });
  it("participant d'une partie annulée : les contributions déjà faites restent visibles", () => {
    expect(canViewFinal({ status: "cancelled" }, ["u1"], "u1")).toBe(true);
    expect(canViewFinal({ status: "cancelled" }, ["u1"], "u2")).toBe(false);
  });
});
