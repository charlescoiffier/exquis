import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("autorise jusqu'au maximum puis refuse, puis se réinitialise", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.check("k", 0)).toBe(true);
    expect(rl.check("k", 10)).toBe(true);
    expect(rl.check("k", 20)).toBe(false);
    expect(rl.check("autre", 20)).toBe(true);
    expect(rl.check("k", 1001)).toBe(true);
  });
});
