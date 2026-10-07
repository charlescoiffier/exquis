import type { Op } from "./ops";

/** Largeur d'un trait : la gomme est un peu plus large que le crayon de même taille (elle emporte aussi la frange adoucie). */
export const strokeWidth = (op: { tool: string; size: number }) => (op.tool === "eraser" ? op.size + 3 : op.size);

export const mid = (a: number[], b: number[]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Opacité du surligneur : constante, et appliquée une seule fois au trait entier (pas de surcharge aux croisements). */
export const HIGHLIGHTER_OPACITY = 0.4;

/** Trait lissé : courbes quadratiques dont les points de contrôle sont les points saisis, raccordées aux milieux des segments. */
export function smoothPath(pts: number[][]): Path2D {
  const p = new Path2D();
  const n = pts.length;
  if (n === 0) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  if (n === 1) {
    p.lineTo(pts[0][0] + 0.01, pts[0][1]); // point isolé : un disque grâce à l'extrémité arrondie
    return p;
  }
  for (let i = 1; i < n - 1; i++) {
    const m = mid(pts[i], pts[i + 1]);
    p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  p.lineTo(pts[n - 1][0], pts[n - 1][1]);
  return p;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine, même suite. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Opacité d'un grain d'aérographe : les grains se superposent, la peinture s'accumule. */
export const SPRAY_DOT_OPACITY = 0.7;

/**
 * Grains d'aérographe des points `from` et suivants d'un tracé (x, y, rayon). Chaque segment est parcouru par pas réguliers,
 * de sorte que la densité ne dépend pas de la vitesse du geste. Les grains ne dépendent que de la graine, du rang du segment
 * et du pas : l'aperçu en direct (qui ajoute les points au fur et à mesure) et le dessin final sont identiques.
 */
export function sprayDots(op: { size: number; seed?: number }, points: number[][], from = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  const step = Math.max(2, op.size / 5);
  const count = Math.max(3, Math.round(op.size * 0.5));
  const radius = Math.max(0.9, op.size / 20);
  const scatter = (index: number, sub: number, x: number, y: number) => {
    const rand = mulberry32((((op.seed ?? 1) * 2654435761) ^ (index * 40503) ^ (sub * 9973)) >>> 0);
    for (let k = 0; k < count; k++) {
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * (op.size / 2);
      out.push([x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, radius]);
    }
  };
  for (let i = Math.max(0, from); i < points.length; i++) {
    if (i === 0) {
      scatter(0, 0, points[0][0], points[0][1]);
      continue;
    }
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 1; j <= n; j++) scatter(i, j, x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n);
  }
  return out;
}

/** Trace une forme (ligne, rectangle, ovale) ; contour de l'épaisseur du trait, ou remplie. */
export function drawShape(ctx: CanvasRenderingContext2D, op: Extract<Op, { kind: "shape" }>): void {
  const { x1, y1, x2, y2 } = op;
  ctx.lineWidth = op.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.beginPath();
  if (op.shape === "line") {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }
  if (op.shape === "rect") ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  else ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
  if (op.filled) ctx.fill();
  else ctx.stroke();
}
