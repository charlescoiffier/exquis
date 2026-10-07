import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { clockOffset, turnPhase } from "@/lib/turn-timing";

const deadline = 1_000_000;

describe("turnPhase", () => {
  it("avant l'échéance : ouvert", () => {
    expect(turnPhase(deadline, deadline - 1)).toEqual({ phase: "open", msToDeadline: 1, msToExpiry: SUBMIT_GRACE_MS + 1 });
  });
  it("à l'échéance : fenêtre de validation", () => {
    expect(turnPhase(deadline, deadline)).toMatchObject({ phase: "validation", msToExpiry: SUBMIT_GRACE_MS });
  });
  it("dans la fenêtre : validation avec le temps restant", () => {
    expect(turnPhase(deadline, deadline + 20_000)).toMatchObject({ phase: "validation", msToExpiry: SUBMIT_GRACE_MS - 20_000 });
  });
  it("à la fin de la fenêtre : expiré", () => {
    expect(turnPhase(deadline, deadline + SUBMIT_GRACE_MS)).toMatchObject({ phase: "expired", msToExpiry: 0 });
    expect(turnPhase(deadline, deadline + SUBMIT_GRACE_MS + 5000)).toMatchObject({ phase: "expired", msToExpiry: 0 });
  });
  it("respecte un délai personnalisé", () => {
    expect(turnPhase(deadline, deadline + 1500, 1000).phase).toBe("expired");
  });
});

describe("clockOffset", () => {
  it("décalage entre l'horloge serveur et celle du client", () => {
    expect(clockOffset("2026-10-07T10:00:10.000Z", Date.parse("2026-10-07T10:00:00.000Z"))).toBe(10_000);
    expect(clockOffset("2026-10-07T10:00:00.000Z", Date.parse("2026-10-07T10:00:05.000Z"))).toBe(-5_000);
  });
  it("0 si la date serveur est absente ou invalide", () => {
    expect(clockOffset(undefined, 123)).toBe(0);
    expect(clockOffset("nope", 123)).toBe(0);
  });
});
