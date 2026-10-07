import { describe, expect, it } from "vitest";
import { floodFill, hexToRgba, isInsideCanvas, sanitizeOps } from "@/lib/drawing/ops";

function image(w: number, h: number, fill: [number, number, number, number] = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { data, width: w, height: h };
}
const at = (img: ReturnType<typeof image>, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe("hexToRgba", () => {
  it("convertit #rrggbb", () => expect(hexToRgba("#ff8000")).toEqual([255, 128, 0, 255]));
});

describe("floodFill", () => {
  it("remplit toute la zone connexe", () => {
    const img = image(4, 4);
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 3, 3)).toEqual([255, 0, 0, 255]);
  });
  it("s'arrête aux frontières de couleur", () => {
    const img = image(4, 4);
    for (let y = 0; y < 4; y++) img.data.set([0, 0, 0, 255], (y * 4 + 2) * 4); // mur vertical x=2
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(img, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(at(img, 3, 1)).toEqual([255, 255, 255, 255]);
  });
  it("ne fait rien si la couleur cible est déjà la bonne", () => {
    const img = image(2, 2, [255, 0, 0, 255]);
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 1, 1)).toEqual([255, 0, 0, 255]);
  });
  it("ignore un point hors image", () => {
    const img = image(2, 2);
    expect(() => floodFill(img, 5, 5, [0, 0, 0, 255])).not.toThrow();
  });
});

describe("isInsideCanvas", () => {
  it("tour 1 : tout le canvas", () => expect(isInsideCanvas(10, 10, "down")).toBe(true));
  it("tour 2 : autorise aussi la bande héritée (down)", () => {
    expect(isInsideCanvas(10, 100, "down")).toBe(true);
    expect(isInsideCanvas(10, 200, "down")).toBe(true);
  });
  it("tour 2 : autorise aussi la bande héritée (right)", () => {
    expect(isInsideCanvas(100, 10, "right")).toBe(true);
    expect(isInsideCanvas(200, 10, "right")).toBe(true);
  });
  it("refuse un point hors du canvas", () => {
    expect(isInsideCanvas(-1, 10, "down")).toBe(false);
    expect(isInsideCanvas(10, 1600, "down")).toBe(false);
  });
});

describe("floodFill avec bounds", () => {
  it("ne touche pas les pixels hors bounds même si la zone est connexe", () => {
    const img = image(4, 4);
    floodFill(img, 3, 3, [255, 0, 0, 255], 16, { left: 0, top: 2, width: 4, height: 2 });
    expect(at(img, 0, 2)).toEqual([255, 0, 0, 255]);
    expect(at(img, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(at(img, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(img, 3, 1)).toEqual([255, 255, 255, 255]);
  });
  it("ne fait rien si le point de départ est hors bounds", () => {
    const img = image(4, 4);
    floodFill(img, 0, 0, [255, 0, 0, 255], 16, { left: 0, top: 2, width: 4, height: 2 });
    expect(at(img, 0, 3)).toEqual([255, 255, 255, 255]);
    expect(at(img, 0, 0)).toEqual([255, 255, 255, 255]);
  });
  it("sans bounds, remplit tout le canvas", () => {
    const img = image(4, 4);
    floodFill(img, 0, 0, [0, 255, 0, 255]);
    expect(at(img, 3, 3)).toEqual([0, 255, 0, 255]);
    expect(at(img, 0, 0)).toEqual([0, 255, 0, 255]);
  });
});

describe("sanitizeOps", () => {
  const good = { kind: "stroke", tool: "brush", color: "#112233", size: 8, opacity: 1, points: [[1, 2, 0.5]] };
  it("garde les opérations valides", () => {
    const f = { kind: "fill", x: 3, y: 4, color: "#ffffff" };
    expect(sanitizeOps([good, f])).toEqual([good, f]);
  });
  it("ignore tout ce qui n'est pas un tableau", () => {
    expect(sanitizeOps(null)).toEqual([]);
    expect(sanitizeOps({})).toEqual([]);
  });
  it("écarte silencieusement les opérations invalides", () => {
    const bad = [
      null, 3, { kind: "x" },
      { ...good, color: "red" },
      { ...good, tool: "spray" },
      { ...good, size: NaN },
      { ...good, opacity: "1" },
      { ...good, points: [] },
      { ...good, points: [[1, 2]] },
      { ...good, points: [[1, 2, Infinity]] },
      { kind: "fill", x: "1", y: 2, color: "#000000" },
      { kind: "fill", x: 1, y: 2, color: "#zzzzzz" },
    ];
    expect(sanitizeOps([...bad, good])).toEqual([good]);
  });
  it("borne le nombre de points", () => {
    expect(sanitizeOps([{ ...good, points: Array.from({ length: 20001 }, () => [0, 0, 1]) }])).toEqual([]);
  });
});
