import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { CLIENT_GRACE_MS, CLIENT_MARGIN_MS, clockOffset, nextClock, turnPhase, type ClockState } from "@/lib/turn-timing";

const deadline = 1_000_000;

describe("marge client", () => {
  it("la fenêtre client se termine avant la coupure serveur", () => {
    expect(CLIENT_MARGIN_MS).toBeGreaterThanOrEqual(3000);
    expect(CLIENT_GRACE_MS).toBe(SUBMIT_GRACE_MS - CLIENT_MARGIN_MS);
  });
});

describe("turnPhase", () => {
  it("avant l'échéance : ouvert", () => {
    expect(turnPhase(deadline, deadline - 1)).toEqual({ phase: "open", msToDeadline: 1, msToExpiry: CLIENT_GRACE_MS + 1 });
  });
  it("à l'échéance : fenêtre de validation", () => {
    expect(turnPhase(deadline, deadline)).toMatchObject({ phase: "validation", msToExpiry: CLIENT_GRACE_MS });
  });
  it("dans la fenêtre : validation avec le temps restant", () => {
    expect(turnPhase(deadline, deadline + 20_000)).toMatchObject({ phase: "validation", msToExpiry: CLIENT_GRACE_MS - 20_000 });
  });
  it("un instant avant la fin de la fenêtre client : encore en validation", () => {
    expect(turnPhase(deadline, deadline + CLIENT_GRACE_MS - 1).phase).toBe("validation");
  });
  it("à la fin de la fenêtre client : expiré, avec la marge avant la coupure serveur", () => {
    expect(turnPhase(deadline, deadline + CLIENT_GRACE_MS)).toMatchObject({ phase: "expired", msToExpiry: 0 });
    expect(deadline + CLIENT_GRACE_MS).toBeLessThan(deadline + SUBMIT_GRACE_MS);
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

describe("nextClock", () => {
  const start: ClockState = { offset: 0, serverNowMs: -Infinity };
  const t = (s: string) => Date.parse(`2026-10-07T10:00:${s}.000Z`);
  it("adopte la première heure serveur", () => {
    expect(nextClock(start, "2026-10-07T10:00:10.000Z", t("00"))).toEqual({ offset: 10_000, serverNowMs: t("10") });
  });
  it("se recale à chaque nouveau rendu serveur", () => {
    const a = nextClock(start, "2026-10-07T10:00:10.000Z", t("00"));
    expect(nextClock(a, "2026-10-07T10:00:20.000Z", t("09"))).toEqual({ offset: 11_000, serverNowMs: t("20") });
  });
  it("ignore une charge plus ancienne que la dernière vue", () => {
    const a = nextClock(start, "2026-10-07T10:00:20.000Z", t("00"));
    expect(nextClock(a, "2026-10-07T10:00:10.000Z", t("05"))).toBe(a);
  });
  it("ignore une date absente ou invalide", () => {
    expect(nextClock(start, undefined, 5)).toBe(start);
    expect(nextClock(start, "nope", 5)).toBe(start);
  });
});
