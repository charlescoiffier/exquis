import { describe, expect, it } from "vitest";
import { floodFill, hexToRgba, isInsideOwnZone } from "@/lib/drawing/ops";

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

describe("isInsideOwnZone", () => {
  it("tour 1 : tout le canvas", () => expect(isInsideOwnZone(10, 10, 1, "down")).toBe(true));
  it("tour 2 : exclut la bande héritée (down)", () => {
    expect(isInsideOwnZone(10, 100, 2, "down")).toBe(false);
    expect(isInsideOwnZone(10, 200, 2, "down")).toBe(true);
  });
  it("tour 2 : exclut la bande héritée (right)", () => {
    expect(isInsideOwnZone(100, 10, 2, "right")).toBe(false);
    expect(isInsideOwnZone(200, 10, 2, "right")).toBe(true);
  });
});
