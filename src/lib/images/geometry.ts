export type Direction = "down" | "right";
export type Rect = { left: number; top: number; width: number; height: number };
export type Joint = { start: number; end: number };

export const LONG_SIDE = 1600;
export const SHORT_SIDE = 1200;
export const BAND_SIZE = 160;

export function canvasSize(d: Direction): { width: number; height: number } {
  return d === "down" ? { width: SHORT_SIDE, height: LONG_SIDE } : { width: LONG_SIDE, height: SHORT_SIDE };
}

export function outgoingRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: height - BAND_SIZE, width, height: BAND_SIZE }
    : { left: width - BAND_SIZE, top: 0, width: BAND_SIZE, height };
}

export function inheritedRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: 0, width, height: BAND_SIZE }
    : { left: 0, top: 0, width: BAND_SIZE, height };
}

export function ownRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: BAND_SIZE, width, height: height - BAND_SIZE }
    : { left: BAND_SIZE, top: 0, width: width - BAND_SIZE, height };
}

/** Positions (le long de l'axe de défilement) des lignes pointillées d'un tour. */
export function guideLines(_d: Direction, rank: number, total: number): number[] {
  if (rank === 1) return [LONG_SIDE - BAND_SIZE];
  if (rank === total) return [BAND_SIZE];
  return [BAND_SIZE, LONG_SIDE - BAND_SIZE];
}

export function finalLength(total: number): number {
  return LONG_SIDE + (total - 1) * (LONG_SIDE - BAND_SIZE);
}

export function jointsFor(total: number): Joint[] {
  const joints: Joint[] = [];
  let end = LONG_SIDE;
  for (let k = 1; k < total; k++) {
    joints.push({ start: end - BAND_SIZE, end });
    end += LONG_SIDE - BAND_SIZE;
  }
  return joints;
}

export function guidesSvg(d: Direction, width: number, height: number, positions: number[]): string {
  const stroke = 'stroke="#e11d48" stroke-width="3" stroke-dasharray="14 10" fill="none"';
  const lines = positions
    .map((p) =>
      d === "down"
        ? `<line x1="0" x2="${width}" y1="${p}" y2="${p}" ${stroke}/>`
        : `<line x1="${p}" x2="${p}" y1="0" y2="${height}" ${stroke}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${lines}</svg>`;
}
