import { describe, expect, it } from "vitest";
import { formatDuration, plural, statusLabel } from "@/lib/format";

describe("formatDuration", () => {
  it.each([[30, "30 s"], [90, "1 min 30 s"], [3600, "1 h"], [5400, "1 h 30 min"], [86400, "1 j"], [604800, "7 j"]])("%i s -> %s", (s, out) => {
    expect(formatDuration(s)).toBe(out);
  });
});

describe("statusLabel", () => {
  it.each([["open", "En attente de joueurs"], ["in_progress", "En cours"], ["completed", "Terminée"], ["cancelled", "Annulée"], ["autre", "autre"]])("%s -> %s", (s, out) => {
    expect(statusLabel(s)).toBe(out);
  });
});

import { DURATION_OPTIONS, formatDate, languageLabel, participantsLabel, turnLabelOf, turnTitle } from "@/lib/format";

describe("languageLabel", () => {
  it.each([["fr", "Français"], ["en", "Anglais"], ["EN", "Anglais"], ["de", "DE"], [null, ""], [undefined, ""]])("%s -> %s", (c, out) => {
    expect(languageLabel(c as string | null | undefined)).toBe(out);
  });
});

describe("participantsLabel", () => {
  it("accorde le nom au nombre", () => {
    expect(participantsLabel("drawing", 4)).toBe("4 dessinateurs");
    expect(participantsLabel("drawing", 1)).toBe("1 dessinateur");
    expect(participantsLabel("text", 3)).toBe("3 écrivains");
    expect(participantsLabel("text", 1)).toBe("1 écrivain");
  });
});

describe("turnTitle / turnLabelOf", () => {
  it("ajoute l'intitulé s'il existe", () => {
    expect(turnTitle(2, 4, "Corps")).toBe("Tour 2 sur 4 · Corps");
    expect(turnTitle(2, 4, "  ")).toBe("Tour 2 sur 4");
    expect(turnTitle(2, 4)).toBe("Tour 2 sur 4");
  });
  it("lit l'intitulé du bon rang", () => {
    expect(turnLabelOf(["Tête", "", "Jambes"], 3)).toBe("Jambes");
    expect(turnLabelOf(["Tête"], 2)).toBe("");
    expect(turnLabelOf(null, 1)).toBe("");
  });
});

describe("DURATION_OPTIONS / formatDate", () => {
  it("propose les six durées demandées", () => {
    expect(DURATION_OPTIONS.map(([, s]) => s)).toEqual([60, 300, 900, 3600, 86400, 604800]);
  });
  it("formate une date en français", () => {
    expect(formatDate("2026-10-06T10:00:00Z")).toBe("6 oct. 2026");
  });
});

describe("plural", () => {
  it("0 et 1 au singulier, 2 et plus au pluriel", () => {
    expect([0, 1, 2, 10].map((n) => plural(n, "partie jouée", "parties jouées"))).toEqual(["partie jouée", "partie jouée", "parties jouées", "parties jouées"]);
  });
});
