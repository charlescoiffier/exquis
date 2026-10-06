import { describe, expect, it } from "vitest";
import { parseGameParams, shuffle } from "@/lib/domain/game-rules";
import { DomainError } from "@/lib/errors";

const drawing = { type: "drawing", name: "Dessin", turns: 4, turnDurationSeconds: 3600, visibility: "public", direction: "down" };
const text = { type: "text", name: "Texte", turns: 3, turnDurationSeconds: 600, visibility: "invite", language: "fr", minWords: 10, maxWords: 100, excerptMode: "paragraph" };

describe("parseGameParams", () => {
  it("accepte un dessin valide", () => {
    expect(parseGameParams(drawing).type).toBe("drawing");
  });
  it("accepte un texte valide", () => {
    expect(parseGameParams(text).type).toBe("text");
  });
  it.each([
    ["trop de tours", { ...drawing, turns: 9 }],
    ["pas assez de tours", { ...drawing, turns: 1 }],
    ["durée < 30 s", { ...drawing, turnDurationSeconds: 29 }],
    ["durée > 7 jours", { ...drawing, turnDurationSeconds: 604801 }],
    ["min > max", { ...text, minWords: 50, maxWords: 10 }],
    ["mode words sans nombre", { ...text, excerptMode: "words" }],
    ["sens inconnu", { ...drawing, direction: "up" }],
    ["nom vide", { ...drawing, name: "  " }],
  ])("refuse : %s", (_label, input) => {
    expect(() => parseGameParams(input)).toThrow(DomainError);
  });
});

describe("shuffle", () => {
  it("est une permutation et ne modifie pas l'entrée", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, () => 0.3);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
