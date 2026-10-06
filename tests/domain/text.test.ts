import { describe, expect, it } from "vitest";
import { countWords, extractExcerpt, sanitizeText, PARAGRAPH_EXCERPT_CAP } from "@/lib/domain/text";

describe("countWords", () => {
  it("compte les mots séparés par des espaces multiples et sauts de ligne", () => {
    expect(countWords("  un  deux\n\ntrois  ")).toBe(3);
  });
  it("renvoie 0 pour un texte vide ou fait d'espaces", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });
  it("gère accents et emoji comme des mots", () => {
    expect(countWords("été à Noël 🎄 ok")).toBe(5);
  });
});

describe("sanitizeText", () => {
  it("normalise les fins de ligne et retire les caractères de contrôle", () => {
    expect(sanitizeText("a\r\nb\u0000c")).toBe("a\nbc");
  });
});

describe("extractExcerpt", () => {
  it("renvoie le dernier paragraphe", () => {
    expect(extractExcerpt("Premier.\n\nSecond.\n\nTroisième.", { mode: "paragraph" })).toBe("Troisième.");
  });
  it("renvoie les X derniers mots", () => {
    expect(extractExcerpt("a b c d e", { mode: "words", count: 2 })).toBe("d e");
  });
  it("plafonne un paragraphe unique trop long", () => {
    const text = Array.from({ length: 400 }, (_, i) => `m${i}`).join(" ");
    const excerpt = extractExcerpt(text, { mode: "paragraph" });
    expect(countWords(excerpt)).toBe(PARAGRAPH_EXCERPT_CAP);
    expect(excerpt.endsWith("m399")).toBe(true);
  });
  it("renvoie une chaîne vide pour un texte vide", () => {
    expect(extractExcerpt("   ", { mode: "paragraph" })).toBe("");
  });
});
