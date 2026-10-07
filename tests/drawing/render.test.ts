import { describe, expect, it } from "vitest";
import { mulberry32, sprayDots, strokeWidth } from "@/lib/drawing/render";

describe("rendu du dessin", () => {
  it("le générateur est déterministe", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("l'aérographe est déterministe, dense quelle que soit la vitesse, et identique en direct (par morceaux) et en final", () => {
    const op = { size: 20, seed: 7 };
    const pts = [[100, 100], [140, 100], [140, 160]];
    const all = sprayDots(op, pts);
    expect(sprayDots(op, pts)).toEqual(all);
    expect(sprayDots({ ...op, seed: 8 }, pts)).not.toEqual(all);
    // Direct : on ajoute les points au fur et à mesure ; le résultat cumulé est le dessin final.
    const live = [...sprayDots(op, pts.slice(0, 1), 0), ...sprayDots(op, pts.slice(0, 2), 1), ...sprayDots(op, pts, 2)];
    expect(live).toEqual(all);
    // Un geste rapide (deux points éloignés) donne autant de grains qu'un geste lent sur la même distance.
    const fast = sprayDots(op, [[0, 0], [100, 0]]);
    const slow = sprayDots(op, Array.from({ length: 11 }, (_, i) => [i * 10, 0]));
    expect(Math.abs(fast.length - slow.length) / fast.length).toBeLessThan(0.2);
    for (const [x, y] of sprayDots(op, [[100, 100]])) expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(10.0001);
  });
  it("la gomme est un peu plus large que le crayon", () => {
    expect(strokeWidth({ tool: "eraser", size: 10 })).toBe(13);
    expect(strokeWidth({ tool: "brush", size: 10 })).toBe(10);
  });
});
