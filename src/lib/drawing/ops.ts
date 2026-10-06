import { canvasSize, ownRect, type Direction } from "@/lib/images/geometry";

export type StrokePoint = [number, number, number];
export type Op =
  | { kind: "stroke"; tool: "brush" | "eraser"; color: string; size: number; opacity: number; points: StrokePoint[] }
  | { kind: "fill"; x: number; y: number; color: string };

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

type Img = { data: Uint8ClampedArray; width: number; height: number };

export function floodFill(img: Img, x: number, y: number, rgba: [number, number, number, number], tolerance = 16): void {
  const { data, width, height } = img;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const start = (y * width + x) * 4;
  const target: [number, number, number, number] = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  if (target.every((v, i) => v === rgba[i])) return;
  const matches = (i: number) =>
    Math.abs(data[i] - target[0]) <= tolerance && Math.abs(data[i + 1] - target[1]) <= tolerance &&
    Math.abs(data[i + 2] - target[2]) <= tolerance && Math.abs(data[i + 3] - target[3]) <= tolerance;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [y * width + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    const i = p * 4;
    if (!matches(i)) continue;
    visited[p] = 1;
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    const px = p % width;
    if (px > 0) stack.push(p - 1);
    if (px < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
}

export function isInsideOwnZone(x: number, y: number, rank: number, direction: Direction): boolean {
  const { width, height } = canvasSize(direction);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  if (rank === 1) return true;
  const r = ownRect(direction);
  return x >= r.left && y >= r.top && x < r.left + r.width && y < r.top + r.height;
}
