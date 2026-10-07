import { canvasSize, type Direction } from "@/lib/images/geometry";

export type StrokePoint = [number, number, number];
/** `brush` : crayon (fin, moyen ou épais selon la taille) ; `highlighter` : surligneur translucide ; `spray` : aérographe. */
export type StrokeTool = "brush" | "eraser" | "highlighter" | "spray";
export type ShapeKind = "line" | "rect" | "oval";
export type Op =
  | { kind: "stroke"; tool: StrokeTool; color: string; size: number; opacity: number; points: StrokePoint[]; /** Graine de l'aérographe (le semis est déterministe). */ seed?: number }
  | { kind: "fill"; x: number; y: number; color: string }
  | { kind: "shape"; shape: ShapeKind; filled: boolean; color: string; size: number; opacity: number; x1: number; y1: number; x2: number; y2: number }
  /** Efface tous les traits du joueur (la bande héritée reste) ; annulable comme les autres opérations. */
  | { kind: "clear" };

const STROKE_TOOLS: readonly string[] = ["brush", "eraser", "highlighter", "spray"];
const SHAPES: readonly string[] = ["line", "rect", "oval"];

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

type Img = { data: Uint8ClampedArray; width: number; height: number };

export type Bounds = { left: number; top: number; width: number; height: number };

export function floodFill(
  img: Img,
  x: number,
  y: number,
  rgba: [number, number, number, number],
  tolerance = 16,
  bounds?: Bounds,
): void {
  const { data, width, height } = img;
  x = Math.floor(x);
  y = Math.floor(y);
  const minX = bounds ? Math.max(0, bounds.left) : 0;
  const minY = bounds ? Math.max(0, bounds.top) : 0;
  const maxX = bounds ? Math.min(width, bounds.left + bounds.width) : width; // exclusif
  const maxY = bounds ? Math.min(height, bounds.top + bounds.height) : height;
  if (x < minX || y < minY || x >= maxX || y >= maxY) return;
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
    const py = (p - px) / width;
    if (px > minX) stack.push(p - 1);
    if (px < maxX - 1) stack.push(p + 1);
    if (py > minY) stack.push(p - width);
    if (py < maxY - 1) stack.push(p + width);
  }
}

/** Le joueur peut peindre sur toute la surface, y compris la bande héritée. */
export function isInsideCanvas(x: number, y: number, direction: Direction): boolean {
  const { width, height } = canvasSize(direction);
  return x >= 0 && y >= 0 && x < width && y < height;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_POINTS = 20000;
const MAX_OPS = 5000;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valide un brouillon restauré : les opérations invalides sont ignorées. */
export function sanitizeOps(raw: unknown): Op[] {
  if (!Array.isArray(raw)) return [];
  const out: Op[] = [];
  for (const item of raw.slice(0, MAX_OPS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.kind === "clear") {
      out.push({ kind: "clear" });
      continue;
    }
    if (typeof o.color !== "string" || !HEX.test(o.color)) continue;
    if (o.kind === "fill") {
      if (fin(o.x) && fin(o.y)) out.push({ kind: "fill", x: o.x, y: o.y, color: o.color });
    } else if (o.kind === "stroke") {
      if (typeof o.tool !== "string" || !STROKE_TOOLS.includes(o.tool) || !fin(o.size) || !fin(o.opacity)) continue;
      if (!Array.isArray(o.points) || o.points.length === 0 || o.points.length > MAX_POINTS) continue;
      const ok = o.points.every((q) => Array.isArray(q) && q.length === 3 && q.every(fin));
      if (!ok) continue;
      out.push({
        kind: "stroke",
        tool: o.tool as StrokeTool,
        color: o.color,
        size: Math.min(200, Math.max(0.5, o.size)),
        opacity: Math.min(1, Math.max(0, o.opacity)),
        points: o.points as StrokePoint[],
        ...(fin(o.seed) ? { seed: Math.floor(o.seed) >>> 0 } : {}),
      });
    } else if (o.kind === "shape") {
      if (typeof o.shape !== "string" || !SHAPES.includes(o.shape) || typeof o.filled !== "boolean") continue;
      if (![o.size, o.opacity, o.x1, o.y1, o.x2, o.y2].every(fin)) continue;
      out.push({
        kind: "shape",
        shape: o.shape as ShapeKind,
        filled: o.filled,
        color: o.color,
        size: Math.min(200, Math.max(0.5, o.size as number)),
        opacity: Math.min(1, Math.max(0, o.opacity as number)),
        x1: o.x1 as number, y1: o.y1 as number, x2: o.x2 as number, y2: o.y2 as number,
      });
    }
  }
  return out;
}
