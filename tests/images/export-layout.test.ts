import { describe, expect, it } from "vitest";
import { authorSegments, finalLength, jointsFor } from "@/lib/images/geometry";
import { RAIL_SIZE, exportLayout, exportScale, truncateLabel } from "@/lib/images/export-layout";

const input = (direction: "down" | "right", n: number, names = ["Alice", "Bob", "Chloé"]) => ({
  direction,
  width: direction === "down" ? 1600 : finalLength(n),
  height: direction === "down" ? finalLength(n) : 1600,
  joints: jointsFor(n),
  segments: authorSegments(n).map((s, i) => ({ ...s, author: names[i] })),
});

describe("exportLayout", () => {
  it("sans option : image seule, aucune marge, aucun élément", () => {
    const l = exportLayout({ ...input("down", 2), showGuides: false });
    expect(l).toMatchObject({ canvasWidth: 1600, canvasHeight: 3040, imageX: 0, imageY: 0, joints: [], rails: [] });
  });
  it("sens down, 3 segments : marge à gauche, texte vertical centré sur chaque zone", () => {
    const i = input("down", 3);
    const l = exportLayout({ ...i, showGuides: true });
    expect(l).toMatchObject({ canvasWidth: 1600 + RAIL_SIZE, canvasHeight: i.height, imageX: RAIL_SIZE, imageY: 0 });
    expect(l.rails).toHaveLength(3);
    l.rails.forEach((r, k) => {
      const seg = authorSegments(3)[k];
      expect(r.rotation).toBe(-90);
      expect(r.label.y).toBe((seg.start + seg.end) / 2);
      expect(r.line.x1).toBe(r.line.x2);
      expect(r.line.y1).toBeGreaterThanOrEqual(seg.start);
      expect(r.line.y2).toBeLessThanOrEqual(seg.end);
      expect(r.label.x).toBeLessThan(r.line.x1);
      expect(r.text).toBe(["Alice", "Bob", "Chloé"][k]);
    });
    expect(new Set(l.rails.map((r) => r.color)).size).toBe(3);
    // 2 jointures x (début, fin), décalées de la marge, sur la largeur de l'image
    expect(l.joints).toEqual([
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1600, y1: 1440, y2: 1440 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1600, y1: 1600, y2: 1600 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1600, y1: 2880, y2: 2880 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1600, y1: 3040, y2: 3040 },
    ]);
  });
  it("sens right, 2 segments : marge au-dessus, texte horizontal centré", () => {
    const i = input("right", 2);
    const l = exportLayout({ ...i, showGuides: true });
    expect(l).toMatchObject({ canvasWidth: i.width, canvasHeight: 1600 + RAIL_SIZE, imageX: 0, imageY: RAIL_SIZE });
    l.rails.forEach((r, k) => {
      const seg = authorSegments(2)[k];
      expect(r.rotation).toBe(0);
      expect(r.label.x).toBe((seg.start + seg.end) / 2);
      expect(r.line.y1).toBe(r.line.y2);
      expect(r.label.y).toBeLessThan(r.line.y1);
    });
    expect(l.joints[0]).toEqual({ x1: 1440, x2: 1440, y1: RAIL_SIZE, y2: RAIL_SIZE + 1600 });
  });
  it("1 segment (partie annulée) : un seul nom, aucune jointure", () => {
    const l = exportLayout({ ...input("down", 1), showGuides: true });
    expect(l.rails).toHaveLength(1);
    expect(l.joints).toEqual([]);
  });
});

describe("exportLayout (cas complémentaires)", () => {
  it("sens right, 3 segments", () => {
    const l = exportLayout({ ...input("right", 3), showGuides: true });
    expect(l.rails.map((r) => r.text)).toEqual(["Alice", "Bob", "Chloé"]);
    expect(l.rails.map((r) => r.label.x)).toEqual([720, 2240, 3760]);
    expect(l.joints).toHaveLength(4);
  });
  it.each(["down", "right"] as const)("tout reste dans le canvas (%s)", (d) => {
    for (const n of [1, 2, 3, 8]) {
      const l = exportLayout({ ...input(d, n, ["A", "B", "C", "D", "E", "F", "G", "H"]), showGuides: true });
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= l.canvasWidth && y <= l.canvasHeight;
      for (const r of l.rails) {
        expect(inside(r.line.x1, r.line.y1) && inside(r.line.x2, r.line.y2)).toBe(true);
        expect(inside(r.label.x, r.label.y)).toBe(true);
      }
      for (const j of l.joints) expect(inside(j.x1, j.y1) && inside(j.x2, j.y2)).toBe(true);
    }
  });
});

describe("exportScale", () => {
  it("1 tant que la surface tient (8 tours down : 1340 × 11680 = 15,65 M px)", () => {
    expect(exportScale(1340, 11680)).toBe(1);
  });
  it("< 1 au-delà (9 tours down), surface réduite sous la limite, proportions gardées", () => {
    const f = exportScale(1340, 13120);
    expect(f).toBeLessThan(1);
    expect(Math.floor(1340 * f) * Math.floor(13120 * f)).toBeLessThanOrEqual(16_000_000);
  });
});

describe("truncateLabel", () => {
  it("garde les noms qui tiennent", () => {
    expect(truncateLabel("Alice", 1440)).toBe("Alice");
  });
  it("seuil exact pour une zone de 1440 px : 58 caractères passent, 59 sont tronqués à 57 + « … »", () => {
    expect(truncateLabel("A".repeat(58), 1440)).toBe("A".repeat(58));
    expect(truncateLabel("A".repeat(59), 1440)).toBe("A".repeat(57) + "…");
  });
  it("tronque avec une ellipse les noms trop longs pour la zone", () => {
    const t = truncateLabel("A".repeat(200), 1440);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThan(80);
  });
  it("laisse au moins un caractère sur une zone minuscule", () => {
    expect(truncateLabel("Alice", 10)).toBe("…");
  });
});
