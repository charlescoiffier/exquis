import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { ABANDONED_MESSAGE, EXPIRED_MESSAGE, encodeMarker, noticeMessage, parseMarker, turnKeyOf } from "@/lib/expired-notice";
import { CLIENT_GRACE_MS } from "@/lib/turn-timing";

const iso = "2026-10-07T10:00:00.000Z";
const dl = Date.parse(iso);
const key = turnKeyOf(2, iso);

describe("marqueur d'expiration", () => {
  it("encode puis décode", () => {
    expect(parseMarker(encodeMarker("abandoned", key))).toEqual({ kind: "abandoned", turnKey: key });
  });
  it("refuse les valeurs inconnues", () => {
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker("n'importe quoi")).toBeNull();
    expect(parseMarker("autre|" + key)).toBeNull();
  });
});

describe("noticeMessage", () => {
  it("expiré : toujours le message de remise en jeu", () => {
    expect(noticeMessage({ kind: "expired", turnKey: key }, dl)).toBe(EXPIRED_MESSAGE);
  });
  it("en attente : rien tant que la fenêtre client n'est pas finie (soumis depuis un autre onglet)", () => {
    expect(noticeMessage({ kind: "pending", turnKey: key }, dl + CLIENT_GRACE_MS - 1)).toBeNull();
    expect(noticeMessage({ kind: "pending", turnKey: key }, dl + CLIENT_GRACE_MS)).toBe(EXPIRED_MESSAGE);
  });
  it("abandonné : message d'abandon puis remise en jeu effective", () => {
    expect(noticeMessage({ kind: "abandoned", turnKey: key }, dl + 10_000)).toBe(ABANDONED_MESSAGE);
    expect(noticeMessage({ kind: "abandoned", turnKey: key }, dl + SUBMIT_GRACE_MS)).toBe(EXPIRED_MESSAGE);
  });
});
