import { describe, expect, it } from "vitest";
import { decideOnExpiry } from "@/lib/domain/expiry";

describe("decideOnExpiry", () => {
  it("échange avec le prochain tour en attente", () => {
    const d = decideOnExpiry({ attempts: 0, pending: [{ id: "b", rank: 3 }, { id: "a", rank: 2 }] });
    expect(d).toEqual({ kind: "swap", withTurnId: "a" });
  });
  it("annule au-delà de 2 remises en jeu s'il reste des tours en attente", () => {
    expect(decideOnExpiry({ attempts: 2, pending: [{ id: "a", rank: 2 }] })).toEqual({ kind: "cancel", reason: "max_attempts" });
  });
  it("lance un appel à participation quand il n'y a plus de tour en attente (dernier tour)", () => {
    expect(decideOnExpiry({ attempts: 0, pending: [] })).toEqual({ kind: "open_call" });
  });
  it("relance l'appel sans limite de tentatives", () => {
    expect(decideOnExpiry({ attempts: 7, pending: [] })).toEqual({ kind: "open_call" });
  });
});
