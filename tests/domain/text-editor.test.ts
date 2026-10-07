import { describe, expect, it } from "vitest";
import { gaugeState, mirrorSegments } from "@/lib/domain/text-editor";

describe("gaugeState", () => {
  it("sous le minimum : message du manque, hors bornes", () => {
    const g = gaugeState(3, 10, 50);
    expect(g).toMatchObject({ status: "under", ok: false, message: "Encore 7 mots pour atteindre le minimum" });
    expect(g.fillPercent).toBeCloseTo(6);
    expect(g.minPercent).toBeCloseTo(20);
  });
  it("singulier", () => {
    expect(gaugeState(9, 10, 50).message).toBe("Encore 1 mot pour atteindre le minimum");
    expect(gaugeState(51, 10, 50).message).toBe("1 mot en trop");
  });
  it("dans les bornes (incluses)", () => {
    expect(gaugeState(10, 10, 50)).toMatchObject({ status: "ok", ok: true, message: "✓ 10 mots, longueur suffisante" });
    expect(gaugeState(50, 10, 50)).toMatchObject({ status: "ok", ok: true });
    expect(gaugeState(1, 1, 5).message).toBe("✓ 1 mot, longueur suffisante");
  });
  it("au-dessus du maximum : barre pleine", () => {
    const g = gaugeState(60, 10, 50);
    expect(g).toMatchObject({ status: "over", ok: false, message: "10 mots en trop", fillPercent: 100 });
  });
});

describe("mirrorSegments", () => {
  it("découpe en [non transmis, transmis, après]", () => {
    expect(mirrorSegments("un\ndeux\ntrois  \n", { start: 8, end: 13 })).toEqual(["un\ndeux\n", "trois", "  \n"]);
  });
  it("plage vide : tout est non transmis", () => {
    expect(mirrorSegments("***", { start: 0, end: 0 })).toEqual(["***", "", ""]);
  });
  it("la concaténation redonne le texte", () => {
    const t = "a b\nc  d";
    expect(mirrorSegments(t, { start: 4, end: 8 }).join("")).toBe(t);
  });
});
