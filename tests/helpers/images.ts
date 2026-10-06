import sharp from "sharp";
import { canvasSize, type Direction } from "@/lib/images/geometry";

export async function solidPng(d: Direction, color: string): Promise<Buffer> {
  const { width, height } = canvasSize(d);
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export async function paste(base: Buffer, overlay: Buffer, left: number, top: number): Promise<Buffer> {
  return sharp(base).composite([{ input: overlay, left, top }]).png().toBuffer();
}

export async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}
