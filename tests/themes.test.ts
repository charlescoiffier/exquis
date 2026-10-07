import { describe, expect, it } from "vitest";
import { DRAWING_THEMES, TEXT_THEMES, THEMES, randomTheme } from "@/lib/themes";
import { parseGameParams } from "@/lib/domain/game-rules";

describe("banque de thèmes", () => {
  it("environ 100 thèmes au total, sans doublon, distincts entre texte et dessin", () => {
    const all = [...TEXT_THEMES, ...DRAWING_THEMES];
    expect(all.length).toBeGreaterThanOrEqual(95);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(t.length).toBeLessThanOrEqual(120);
  });
  it("randomTheme tire dans la banque du type demandé", () => {
    expect(randomTheme("text", () => 0)).toBe(THEMES.text[0]);
    expect(randomTheme("drawing", () => 0.999999)).toBe(DRAWING_THEMES[DRAWING_THEMES.length - 1]);
    for (let i = 0; i < 50; i++) {
      expect(TEXT_THEMES).toContain(randomTheme("text"));
      expect(DRAWING_THEMES).toContain(randomTheme("drawing"));
    }
  });
  it("le thème est facultatif et limité à 120 caractères", () => {
    const base = { type: "text", turns: 2, turnDurationSeconds: 3600, visibility: "public", language: "fr", minWords: 1, maxWords: 10, excerptMode: "paragraph" };
    expect(parseGameParams(base).theme).toBeUndefined();
    expect(parseGameParams({ ...base, theme: "  Un thème  " }).theme).toBe("Un thème");
    expect(() => parseGameParams({ ...base, theme: "x".repeat(121) })).toThrow();
  });
});
