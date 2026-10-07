import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { ABANDONED_MESSAGE, EXPIRED_MESSAGE, encodeMarker, editorMarkerAction, noticeDecision, parseMarker, turnKeyOf } from "@/lib/expired-notice";
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

describe("noticeDecision (cycle de vie du marqueur)", () => {
  it("expiré : message, marqueur consommé", () => {
    expect(noticeDecision({ kind: "expired", turnKey: key }, dl)).toEqual({ message: EXPIRED_MESSAGE, consume: true });
  });
  it("en attente + tour disparu avant la fin de la fenêtre (envoi ailleurs) : rien, marqueur consommé", () => {
    expect(noticeDecision({ kind: "pending", turnKey: key }, dl + CLIENT_GRACE_MS - 1)).toEqual({ message: null, consume: true });
  });
  it("en attente + fenêtre écoulée : message une seule fois (consommé)", () => {
    expect(noticeDecision({ kind: "pending", turnKey: key }, dl + CLIENT_GRACE_MS)).toEqual({ message: EXPIRED_MESSAGE, consume: true });
  });
  it("abandonné : message d'abandon (conservé), puis message d'expiration après échéance + 60 s", () => {
    expect(noticeDecision({ kind: "abandoned", turnKey: key }, dl + 10_000)).toEqual({ message: ABANDONED_MESSAGE, consume: false });
    expect(noticeDecision({ kind: "abandoned", turnKey: key }, dl + SUBMIT_GRACE_MS)).toEqual({ message: EXPIRED_MESSAGE, consume: true });
  });
});

describe("editorMarkerAction", () => {
  it("aucun marqueur : rien", () => expect(editorMarkerAction(null, key)).toEqual({ lost: null, clear: false }));
  it("marqueur d'un autre tour : effacé", () => {
    expect(editorMarkerAction({ kind: "abandoned", turnKey: turnKeyOf(1, iso) }, key)).toEqual({ lost: null, clear: true });
  });
  it("même tour : abandonné/expiré = perdu ; en attente = éditeur ouvert", () => {
    expect(editorMarkerAction({ kind: "abandoned", turnKey: key }, key)).toEqual({ lost: "abandoned", clear: false });
    expect(editorMarkerAction({ kind: "expired", turnKey: key }, key)).toEqual({ lost: "expired", clear: false });
    expect(editorMarkerAction({ kind: "pending", turnKey: key }, key)).toEqual({ lost: null, clear: false });
  });
});
