import { describe, expect, it } from "vitest";
import { AVATAR_COLORS, AVATAR_SHAPES, defaultAvatar, isValidAvatar, resolveAvatar } from "@/lib/avatar";

describe("avatars", () => {
  it("l'avatar par défaut est stable, valide, et varie selon le compte", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = defaultAvatar(`user-${i}`);
      expect(defaultAvatar(`user-${i}`)).toEqual(a);
      expect(isValidAvatar(a)).toBe(true);
      seen.add(a.shape);
    }
    expect(seen.size).toBeGreaterThan(6);
  });
  it("le choix du joueur prévaut ; un choix stocké invalide retombe sur l'avatar par défaut", () => {
    expect(resolveAvatar("u", { avatarShape: "ring", avatarColor: "red", avatarBg: "cream" })).toEqual({ shape: "ring", color: "red", bg: "cream" });
    expect(resolveAvatar("u", { avatarShape: "ring", avatarColor: "red", avatarBg: "red" })).toEqual(defaultAvatar("u"));
    expect(resolveAvatar("u", { avatarShape: null, avatarColor: null, avatarBg: null })).toEqual(defaultAvatar("u"));
    expect(resolveAvatar("u", undefined)).toEqual(defaultAvatar("u"));
  });
  it("palette fixe : 12 formes, 8 couleurs aux identifiants uniques", () => {
    expect(AVATAR_SHAPES).toHaveLength(12);
    expect(new Set(AVATAR_COLORS.map((c) => c.id)).size).toBe(8);
    expect(new Set(AVATAR_SHAPES.map((s) => s.id)).size).toBe(12);
  });
});
