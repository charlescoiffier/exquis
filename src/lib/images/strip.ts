import sharp, { type Metadata } from "sharp";
import { DomainError } from "@/lib/errors";
import {
  BAND_SIZE,
  LONG_SIDE,
  canvasSize,
  finalLength,
  guidesSvg,
  inheritedRect,
  jointsFor,
  outgoingRect,
  ownRect,
  type Direction,
  type Joint,
} from "./geometry";

export const MAX_PNG_BYTES = 8_000_000;
const WHITE = { r: 255, g: 255, b: 255 };
const bad = (message: string) => new DomainError("invalid_image", message, 400);

export async function validateDrawingPng(png: Buffer, d: Direction): Promise<void> {
  if (png.length === 0 || png.length > MAX_PNG_BYTES) throw bad("Image trop volumineuse ou vide.");
  let meta: Metadata;
  try {
    meta = await sharp(png, { limitInputPixels: 4_000_000 }).metadata();
  } catch {
    throw bad("Fichier image illisible.");
  }
  const { width, height } = canvasSize(d);
  if (meta.format !== "png") throw bad("L'image doit être un PNG.");
  if (meta.width !== width || meta.height !== height) throw bad(`Dimensions attendues : ${width}×${height}.`);
}

export async function extractStrip(png: Buffer, d: Direction): Promise<Buffer> {
  return sharp(png).flatten({ background: WHITE }).extract(outgoingRect(d)).png().toBuffer();
}

export async function assembleDrawing(
  pngs: Buffer[],
  d: Direction,
): Promise<{ image: Buffer; width: number; height: number; joints: Joint[] }> {
  const total = pngs.length;
  const length = finalLength(total);
  const size = canvasSize(d);
  const width = d === "down" ? size.width : length;
  const height = d === "down" ? length : size.height;

  const place = (input: Buffer, offset: number) => (d === "down" ? { input, left: 0, top: offset } : { input, left: offset, top: 0 });
  const ownParts = await Promise.all(
    pngs.map(async (png, i) => {
      const base = sharp(png).flatten({ background: WHITE });
      const input = i === 0 ? await base.png().toBuffer() : await base.extract(ownRect(d)).png().toBuffer();
      return place(input, i === 0 ? 0 : LONG_SIDE + (i - 1) * (LONG_SIDE - BAND_SIZE));
    }),
  );
  // Le joueur peut repeindre la bande héritée : sa version retouchée remplace, après la pose des zones propres,
  // la bande sortante du tour précédent (qui précède immédiatement la zone propre du tour i).
  const overlays = await Promise.all(
    pngs.slice(1).map(async (png, k) => {
      const input = await sharp(png).flatten({ background: WHITE }).extract(inheritedRect(d)).png().toBuffer();
      return place(input, LONG_SIDE + k * (LONG_SIDE - BAND_SIZE) - BAND_SIZE);
    }),
  );
  const parts = [...ownParts, ...overlays];

  const image = await sharp({ create: { width, height, channels: 3, background: WHITE } })
    .composite(parts)
    .png()
    .toBuffer();
  return { image, width, height, joints: jointsFor(total) };
}

export async function renderWithGuides(
  clean: Buffer,
  d: Direction,
  width: number,
  height: number,
  joints: Joint[],
): Promise<Buffer> {
  const svg = guidesSvg(d, width, height, joints.flatMap((j) => [j.start, j.end]));
  return sharp(clean).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}
