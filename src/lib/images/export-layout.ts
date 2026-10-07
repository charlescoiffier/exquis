import type { Direction, Joint } from "./geometry";

/** Épaisseur (en pixels de l'image) de la marge des noms ajoutée à gauche (down) ou au-dessus (right). */
export const RAIL_SIZE = 140;
export const LABEL_FONT_SIZE = 40;
export const RAIL_COLORS = ["#101010", "#F2B705", "#0B7A75", "#6B6B64", "#08504D", "#8A6A00", "#B3261E", "#A0A096"];
const LINE_INSET = 8;
const LINE_OFFSET = 16; // distance de la ligne colorée au bord de l'image
const LABEL_GAP = 14; // distance du texte à la ligne
const CHAR_WIDTH = 0.6; // largeur moyenne d'un caractère, en fraction du corps de police

export type Line = { x1: number; y1: number; x2: number; y2: number };
export type Rail = { rank: number; text: string; color: string; line: Line; label: { x: number; y: number }; rotation: 0 | -90 };
export type ExportLayout = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  joints: Line[];
  rails: Rail[];
};
export type ExportInput = {
  direction: Direction;
  width: number;
  height: number;
  joints: Joint[];
  segments: { rank: number; author: string; label?: string; start: number; end: number }[];
  showGuides: boolean;
};

/**
 * Règle de troncature : un nom ne doit pas dépasser la zone dessinée de son auteur (moins 40 px de respiration).
 * Le nombre de caractères admis est estimé (corps × 0,6 par caractère) ; au-delà, le nom est coupé et suivi de « … ».
 * Il reste toujours au moins un caractère affiché (« … » seul si la zone est minuscule).
 */
export function truncateLabel(text: string, zoneLength: number): string {
  const max = Math.max(1, Math.floor((zoneLength - 40) / (LABEL_FONT_SIZE * CHAR_WIDTH)));
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Calcule la disposition de l'export (et de l'affichage) : taille du canvas, marge des noms, lignes et libellés. */
export function exportLayout(i: ExportInput): ExportLayout {
  if (!i.showGuides) {
    return { canvasWidth: i.width, canvasHeight: i.height, imageX: 0, imageY: 0, joints: [], rails: [] };
  }
  const down = i.direction === "down";
  const imageX = down ? RAIL_SIZE : 0;
  const imageY = down ? 0 : RAIL_SIZE;
  const joints: Line[] = i.joints
    .flatMap((j) => [j.start, j.end])
    .map((p) =>
      down
        ? { x1: imageX, x2: imageX + i.width, y1: p, y2: p }
        : { x1: p, x2: p, y1: imageY, y2: imageY + i.height },
    );
  const lineAt = RAIL_SIZE - LINE_OFFSET;
  const rails: Rail[] = i.segments.map((s, k) => {
    const mid = (s.start + s.end) / 2;
    const a = s.start + LINE_INSET;
    const b = s.end - LINE_INSET;
    return {
      rank: s.rank,
      text: truncateLabel(s.label ? `${s.author} · ${s.label}` : s.author, s.end - s.start),
      color: RAIL_COLORS[k % RAIL_COLORS.length],
      line: down ? { x1: lineAt, x2: lineAt, y1: a, y2: b } : { x1: a, x2: b, y1: lineAt, y2: lineAt },
      label: down ? { x: lineAt - LABEL_GAP, y: mid } : { x: mid, y: lineAt - LABEL_GAP },
      rotation: down ? -90 : 0,
    };
  });
  return {
    canvasWidth: i.width + (down ? RAIL_SIZE : 0),
    canvasHeight: i.height + (down ? 0 : RAIL_SIZE),
    imageX,
    imageY,
    joints,
    rails,
  };
}

/** Surface maximale d'un canvas pour l'export (limite iOS Safari ≈ 16,77 M px). */
export const MAX_EXPORT_AREA = 16_000_000;

/**
 * Facteur d'échelle uniforme (≤ 1) à appliquer à l'export pour que largeur × hauteur reste sous `maxArea`.
 * Les proportions, les traits et les textes sont réduits ensemble ; 1 si la surface tient déjà.
 */
export function exportScale(canvasWidth: number, canvasHeight: number, maxArea = MAX_EXPORT_AREA): number {
  const area = canvasWidth * canvasHeight;
  return area <= maxArea ? 1 : Math.sqrt(maxArea / area);
}
