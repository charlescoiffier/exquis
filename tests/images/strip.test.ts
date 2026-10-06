import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assembleDrawing, extractStrip, inheritedZoneIntact, renderWithGuides, validateDrawingPng } from "@/lib/images/strip";
import { jointsFor } from "@/lib/images/geometry";
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
    const jpeg = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    await expect(validateDrawingPng(jpeg, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("refuse de mauvaises dimensions", async () => {
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(validateDrawingPng(small, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("refuse les dimensions du mauvais sens", async () => {
    await expect(validateDrawingPng(await solidPng("right", "#fff"), "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
});

describe("extractStrip / inheritedZoneIntact", () => {
  it("la bande extraite fait 1200×160 (down)", async () => {
    const strip = await extractStrip(await solidPng("down", "#ff0000"), "down");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 160]);
  });
  it("la bande extraite fait 160×1200 (right)", async () => {
    const strip = await extractStrip(await solidPng("right", "#ff0000"), "right");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([160, 1200]);
  });
  it("détecte une zone héritée intacte puis modifiée", async () => {
    const strip = await extractStrip(await solidPng("down", "#ff0000"), "down");
    const next = await paste(await solidPng("down", "#00ff00"), strip, 0, 0);
    expect(await inheritedZoneIntact(next, strip, "down")).toBe(true);
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    expect(await inheritedZoneIntact(await paste(next, black, 10, 10), strip, "down")).toBe(false);
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
    expect(out.width).toBe(1200);
    expect(out.height).toBe(4480);
    expect(out.joints).toEqual(jointsFor(3));
    expect(await pixel(out.image, 10, 10)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 10, 1700)).toEqual([0, 255, 0]);
    expect(await pixel(out.image, 10, 3100)).toEqual([0, 0, 255]);
  });
  it("assemble horizontalement (right)", async () => {
    const a = await solidPng("right", "#ff0000");
    const b = await paste(await solidPng("right", "#00ff00"), await extractStrip(a, "right"), 0, 0);
    const out = await assembleDrawing([a, b], "right");
    expect([out.width, out.height]).toEqual([3040, 1200]);
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
