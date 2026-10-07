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
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
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

/**
 * Plage allant du `count`-ième dernier mot (jeton contenant une lettre ou un chiffre) de
 * `text.slice(from, to)` jusqu'à la fin de son dernier jeton non blanc (la ponctuation finale
 * reste donc dans la plage, sans ajouter de mot). `null` s'il n'y a aucun mot.
 */
function lastWordsRange(text: string, from: number, to: number, count: number): TextRange | null {
  const toks = [...text.slice(from, to).matchAll(/\S+/gu)];
  const words = toks.filter((t) => /[\p{L}\p{N}]/u.test(t[0]));
  if (words.length === 0) return null;
  const first = words[Math.max(0, words.length - count)];
  const last = toks[toks.length - 1];
  return { start: from + first.index, end: from + last.index + last[0].length };
}

function excerptRange(text: string, rule: ExcerptRule): TextRange & { capped: boolean } {
  const empty = { start: 0, end: 0, capped: false };
  if (rule.mode === "words") {
    const r = lastWordsRange(text, 0, text.length, rule.count);
    return r ? { ...r, capped: false } : empty;
  }
  const line = lastLineRange(text);
  if (!line) return empty;
  if (countWords(text.slice(line.start, line.end)) > PARAGRAPH_EXCERPT_CAP) {
    const r = lastWordsRange(text, line.start, line.end, PARAGRAPH_EXCERPT_CAP);
    return r ? { ...r, capped: true } : empty;
  }
  return countWords(text.slice(line.start, line.end)) === 0 ? empty : { ...line, capped: false };
}

/**
 * Partie de `text` transmise au joueur suivant, en indices de caractères dans `text`
 * (sans espace de bordure ; `start === end` si rien n'est transmis).
 * `extractExcerpt` en est la tranche, les espaces internes étant réduits à un seul
 * lorsque l'extrait est découpé en mots (mode « mots » ou paragraphe plafonné).
 */
export function transmittedRange(text: string, rule: ExcerptRule): TextRange {
  const { start, end } = excerptRange(text, rule);
  return { start, end };
}

export function extractExcerpt(text: string, rule: ExcerptRule): string {
  const { start, end, capped } = excerptRange(text, rule);
  const slice = text.slice(start, end);
  return rule.mode === "words" || capped ? slice.split(/\s+/u).join(" ") : slice;
}
