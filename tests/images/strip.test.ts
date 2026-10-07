import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assembleDrawing, extractStrip, renderWithGuides, validateDrawingPng } from "@/lib/images/strip";
import { BAND_SIZE, LONG_SIDE, canvasSize, finalLength, jointsFor, ownRect, type Direction } from "@/lib/images/geometry";
import { DomainError } from "@/lib/errors";
import { paste, pixel, solidPng } from "../helpers/images";

describe("validateDrawingPng", () => {
  it("accepte un PNG aux bonnes dimensions", async () => {
    await expect(validateDrawingPng(await solidPng("down", "#fff"), "down")).resolves.toBeUndefined();
  });
  it("refuse un fichier qui n'est pas un PNG", async () => {
    await expect(validateDrawingPng(Buffer.from("not an image"), "down")).rejects.toBeInstanceOf(DomainError);
  });
  it("refuse un JPEG", async () => {
    const jpeg = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    await expect(validateDrawingPng(jpeg, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("refuse de mauvaises dimensions", async () => {
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(validateDrawingPng(small, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
});

describe("extractStrip", () => {
  it("la bande extraite fait 1600×160 (down)", async () => {
    const strip = await extractStrip(await solidPng("down", "#ff0000"), "down");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([1600, 160]);
  });
  it("la bande extraite fait 160×1600 (right)", async () => {
    const strip = await extractStrip(await solidPng("right", "#ff0000"), "right");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([160, 1600]);
  });
});

/** Référence « à l'ancienne » : empilement des seules zones propres, sans superposition de bande héritée. */
async function oldWayAssemble(pngs: Buffer[], d: Direction): Promise<Buffer> {
  const length = finalLength(pngs.length);
  const size = canvasSize(d);
  const parts = await Promise.all(
    pngs.map(async (png, i) => {
      const base = sharp(png).flatten({ background: "#fff" });
      const input = i === 0 ? await base.png().toBuffer() : await base.extract(ownRect(d)).png().toBuffer();
      const offset = i === 0 ? 0 : LONG_SIDE + (i - 1) * (LONG_SIDE - BAND_SIZE);
      return d === "down" ? { input, left: 0, top: offset } : { input, left: offset, top: 0 };
    }),
  );
  return sharp({ create: { width: d === "down" ? size.width : length, height: d === "down" ? length : size.height, channels: 3, background: "#fff" } })
    .composite(parts)
    .removeAlpha()
    .raw()
    .toBuffer();
}

describe("assembleDrawing : bandes non retouchées", () => {
  for (const d of ["down", "right"] as const) {
    it(`3 tours (${d}) : image identique pixel pour pixel à l'empilement des zones propres`, async () => {
      const noise = async (color: string) => {
        const base = await solidPng(d, color);
        const dot = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#123456" } }).png().toBuffer();
        return paste(base, dot, 300, 700);
      };
      const a = await noise("#ff0000");
      const b = await paste(await noise("#00ff00"), await extractStrip(a, d), 0, 0);
      const c = await paste(await noise("#0000ff"), await extractStrip(b, d), 0, 0);
      const out = await assembleDrawing([a, b, c], d);
      const raw = await sharp(out.image).removeAlpha().raw().toBuffer();
      expect(raw.equals(await oldWayAssemble([a, b, c], d))).toBe(true);
    });
  }
  it("2 contributions seulement (partie annulée) avec une bande retouchée : la retouche apparaît", async () => {
    const red = await solidPng("down", "#ff0000");
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    const green = await paste(await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0), black, 10, 10);
    const out = await assembleDrawing([red, green], "down");
    expect(out.height).toBe(finalLength(2));
    expect(await pixel(out.image, 20, 1440 + 20)).toEqual([0, 0, 0]);
    expect(await pixel(out.image, 100, 1440 + 20)).toEqual([255, 0, 0]);
  });
});

describe("assembleDrawing", () => {
  it("empile les tours sans dupliquer les bandes (down)", async () => {
    const red = await solidPng("down", "#ff0000");
    const stripRed = await extractStrip(red, "down");
    const green = await paste(await solidPng("down", "#00ff00"), stripRed, 0, 0);
    const stripGreen = await extractStrip(green, "down");
    const blue = await paste(await solidPng("down", "#0000ff"), stripGreen, 0, 0);

    const out = await assembleDrawing([red, green, blue], "down");
    expect(out.width).toBe(1600);
    expect(out.height).toBe(4480);
    expect(out.joints).toEqual(jointsFor(3));
    expect(await pixel(out.image, 10, 10)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 10, 1700)).toEqual([0, 255, 0]);
    expect(await pixel(out.image, 10, 3100)).toEqual([0, 0, 255]);
  });
  it("sans retouche, la superposition de la bande héritée ne change rien (down)", async () => {
    const red = await solidPng("down", "#ff0000");
    const green = await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0);
    const out = await assembleDrawing([red, green], "down");
    expect(await pixel(out.image, 10, 1500)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 10, 1600)).toEqual([0, 255, 0]);
  });
  it("une bande héritée retouchée apparaît sur la bande sortante du tour précédent (down)", async () => {
    const red = await solidPng("down", "#ff0000");
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    const green = await paste(await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0), black, 10, 10);
    const blue = await paste(await solidPng("down", "#0000ff"), await extractStrip(green, "down"), 0, 0);
    const out = await assembleDrawing([red, green, blue], "down");
    // bande du tour 2 (haut du canvas) -> [1440, 1600) de l'image finale
    expect(await pixel(out.image, 20, 1440 + 20)).toEqual([0, 0, 0]);
    expect(await pixel(out.image, 100, 1440 + 20)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 20, 1600 + 20)).toEqual([0, 255, 0]);
    // le tour 3 n'a pas retouché : sa bande héritée (sortante du tour 2) reste identique, y compris en bas du tour 2
    expect(await pixel(out.image, 100, 1440 + 159)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 100, 3040 - 10)).toEqual([0, 255, 0]);
  });
  it("une bande héritée retouchée apparaît sur la bande sortante du tour précédent (right)", async () => {
    const red = await solidPng("right", "#ff0000");
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    const green = await paste(await paste(await solidPng("right", "#00ff00"), await extractStrip(red, "right"), 0, 0), black, 10, 10);
    const out = await assembleDrawing([red, green], "right");
    expect(await pixel(out.image, 1440 + 20, 20)).toEqual([0, 0, 0]);
    expect(await pixel(out.image, 1440 + 100, 100)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 1600 + 20, 20)).toEqual([0, 255, 0]);
  });
  it("assemble horizontalement (right)", async () => {
    const a = await solidPng("right", "#ff0000");
    const b = await paste(await solidPng("right", "#00ff00"), await extractStrip(a, "right"), 0, 0);
    const out = await assembleDrawing([a, b], "right");
    expect([out.width, out.height]).toEqual([3040, 1600]);
    expect(await pixel(out.image, 1700, 10)).toEqual([0, 255, 0]);
  });
});

describe("renderWithGuides", () => {
  it("superpose des guides sans changer les dimensions", async () => {
    const out = await assembleDrawing([await solidPng("down", "#ffffff"), await solidPng("down", "#ffffff")], "down");
    const guided = await renderWithGuides(out.image, "down", out.width, out.height, out.joints);
    const meta = await sharp(guided).metadata();
    expect([meta.width, meta.height]).toEqual([out.width, out.height]);
    expect(guided.equals(out.image)).toBe(false);
  });
});
