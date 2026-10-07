export const PARAGRAPH_EXCERPT_CAP = 150;

export type ExcerptRule = { mode: "paragraph" } | { mode: "words"; count: number };

/** Un mot est un jeton séparé par des espaces contenant au moins une lettre ou un chiffre Unicode. */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((tok) => /[\p{L}\p{N}]/u.test(tok)).length;
}

/**
 * Normalisation appliquée côté serveur au texte soumis avant stockage.
 * Le client doit l'appliquer au contenu brut AVANT de calculer `transmittedRange`,
 * pour que les indices correspondent au texte réellement stocké.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export type TextRange = { start: number; end: number };

/** Dernière ligne non vide (hors espaces de bordure), en indices de `text` ; CR, LF et CRLF séparent les lignes. */
function lastLineRange(text: string): TextRange | null {
  let last: TextRange | null = null;
  for (const m of text.matchAll(/\S[^\r\n]*/gu)) {
    last = { start: m.index, end: m.index + m[0].trimEnd().length };
  }
  return last;
}

/** Plage couvrant les `count` derniers jetons (séparés par des espaces) de `text.slice(from, to)`. */
function lastTokensRange(text: string, from: number, to: number, count: number): TextRange | null {
  const toks = [...text.slice(from, to).matchAll(/\S+/gu)];
  if (toks.length === 0) return null;
  const first = toks[Math.max(0, toks.length - count)];
  const last = toks[toks.length - 1];
  return { start: from + first.index, end: from + last.index + last[0].length };
}

/**
 * Partie de `text` transmise au joueur suivant, en indices de caractères dans `text`
 * (sans espace de bordure ; `start === end` si rien n'est transmis).
 * `extractExcerpt` en est la tranche, les espaces internes étant réduits à un seul
 * lorsque l'extrait est découpé en mots (mode « mots » ou paragraphe plafonné).
 */
export function transmittedRange(text: string, rule: ExcerptRule): TextRange {
  const empty = { start: 0, end: 0 };
  if (rule.mode === "words") return lastTokensRange(text, 0, text.length, rule.count) ?? empty;
  const line = lastLineRange(text);
  if (!line) return empty;
  if (countWords(text.slice(line.start, line.end)) > PARAGRAPH_EXCERPT_CAP) {
    return lastTokensRange(text, line.start, line.end, PARAGRAPH_EXCERPT_CAP) ?? empty;
  }
  return line;
}

export function extractExcerpt(text: string, rule: ExcerptRule): string {
  const { start, end } = transmittedRange(text, rule);
  const slice = text.slice(start, end);
  const line = rule.mode === "paragraph" ? lastLineRange(text) : null;
  const capped = line !== null && line.end - line.start > slice.length;
  return rule.mode === "words" || capped ? slice.split(/\s+/u).join(" ") : slice;
}
