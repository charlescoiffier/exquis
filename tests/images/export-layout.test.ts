import { describe, expect, it } from "vitest";
import { authorSegments, jointsFor } from "@/lib/images/geometry";
import { RAIL_SIZE, exportLayout, truncateLabel } from "@/lib/images/export-layout";

const input = (direction: "down" | "right", n: number, names = ["Alice", "Bob", "Chloé"]) => ({
  direction,
  width: direction === "down" ? 1200 : 1600 * 0 + (1600 + (n - 1) * 1440),
  height: direction === "down" ? 1600 + (n - 1) * 1440 : 1200,
  joints: jointsFor(n),
  segments: authorSegments(n).map((s, i) => ({ ...s, author: names[i] })),
});

describe("exportLayout", () => {
  it("sans option : image seule, aucune marge, aucun élément", () => {
    const l = exportLayout({ ...input("down", 2), showGuides: false });
    expect(l).toMatchObject({ canvasWidth: 1200, canvasHeight: 3040, imageX: 0, imageY: 0, joints: [], rails: [] });
  });
  it("sens down, 3 segments : marge à gauche, texte vertical centré sur chaque zone", () => {
    const i = input("down", 3);
    const l = exportLayout({ ...i, showGuides: true });
    expect(l).toMatchObject({ canvasWidth: 1200 + RAIL_SIZE, canvasHeight: i.height, imageX: RAIL_SIZE, imageY: 0 });
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
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1200, y1: 1440, y2: 1440 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1200, y1: 1600, y2: 1600 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1200, y1: 2880, y2: 2880 },
      { x1: RAIL_SIZE, x2: RAIL_SIZE + 1200, y1: 3040, y2: 3040 },
    ]);
  });
  it("sens right, 2 segments : marge au-dessus, texte horizontal centré", () => {
    const i = input("right", 2);
    const l = exportLayout({ ...i, showGuides: true });
    expect(l).toMatchObject({ canvasWidth: i.width, canvasHeight: 1200 + RAIL_SIZE, imageX: 0, imageY: RAIL_SIZE });
    l.rails.forEach((r, k) => {
      const seg = authorSegments(2)[k];
      expect(r.rotation).toBe(0);
      expect(r.label.x).toBe((seg.start + seg.end) / 2);
      expect(r.line.y1).toBe(r.line.y2);
      expect(r.label.y).toBeLessThan(r.line.y1);
    });
    expect(l.joints[0]).toEqual({ x1: 1440, x2: 1440, y1: RAIL_SIZE, y2: RAIL_SIZE + 1200 });
  });
  it("1 segment (partie annulée) : un seul nom, aucune jointure", () => {
    const l = exportLayout({ ...input("down", 1), showGuides: true });
    expect(l.rails).toHaveLength(1);
    expect(l.joints).toEqual([]);
  });
});

describe("truncateLabel", () => {
  it("garde les noms qui tiennent", () => {
    expect(truncateLabel("Alice", 1440)).toBe("Alice");
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
