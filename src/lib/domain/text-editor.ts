import type { TextRange } from "./text";

export type GaugeState = {
  status: "under" | "ok" | "over";
  ok: boolean;
  message: string;
  /** Remplissage de la barre (0 à 100, échelle 0 à `max`). */
  fillPercent: number;
  /** Position du repère du minimum (0 à 100). */
  minPercent: number;
};

const mots = (n: number) => `${n} mot${n > 1 ? "s" : ""}`;

export function gaugeState(words: number, min: number, max: number): GaugeState {
  const pct = (n: number) => (max > 0 ? Math.min(100, (n / max) * 100) : 0);
  const base = { fillPercent: pct(words), minPercent: pct(min) };
  if (words < min) return { ...base, status: "under", ok: false, message: `Encore ${mots(min - words)} pour atteindre le minimum` };
  if (words > max) return { ...base, status: "over", ok: false, message: `${mots(words - max)} en trop` };
  return { ...base, status: "ok", ok: true, message: `✓ ${mots(words)}, longueur suffisante` };
}

/** Texte (déjà passé par `sanitizeText`) découpé en [avant la plage, plage transmise, après] ; plage vide : tout est « avant ». */
export function mirrorSegments(text: string, range: TextRange): [string, string, string] {
  if (range.start >= range.end) return [text, "", ""];
  return [text.slice(0, range.start), text.slice(range.start, range.end), text.slice(range.end)];
}
