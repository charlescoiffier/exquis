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
  type Rect,
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

async function rawRegion(img: Buffer, rect: Rect): Promise<Buffer> {
  return sharp(img).flatten({ background: WHITE }).extract(rect).removeAlpha().raw().toBuffer();
}

export async function inheritedZoneIntact(png: Buffer, strip: Buffer, d: Direction, tolerance = 2): Promise<boolean> {
  const a = await rawRegion(png, inheritedRect(d));
  const b = await sharp(strip).flatten({ background: WHITE }).removeAlpha().raw().toBuffer();
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
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

  const parts = await Promise.all(
    pngs.map(async (png, i) => {
      const base = sharp(png).flatten({ background: WHITE });
      const input = i === 0 ? await base.png().toBuffer() : await base.extract(ownRect(d)).png().toBuffer();
      const offset = i === 0 ? 0 : LONG_SIDE + (i - 1) * (LONG_SIDE - BAND_SIZE);
      return d === "down" ? { input, left: 0, top: offset } : { input, left: offset, top: 0 };
    }),
  );

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
