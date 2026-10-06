import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/storage/token";

describe("token signé", () => {
  const secret = "s".repeat(32);
  it("valide un token non expiré", () => {
    const t = signToken("games/1/a.png", 2000, secret);
    expect(verifyToken(t, secret, 1000)).toBe("games/1/a.png");
  });
  it("refuse un token expiré", () => {
    expect(verifyToken(signToken("k", 1000, secret), secret, 1001)).toBeNull();
  });
  it("refuse un token falsifié ou signé avec un autre secret", () => {
    const t = signToken("k", 2000, secret);
    expect(verifyToken(t + "x", secret, 1000)).toBeNull();
    expect(verifyToken(t, "o".repeat(32), 1000)).toBeNull();
  });
});
