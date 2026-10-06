export const PARAGRAPH_EXCERPT_CAP = 150;

export type ExcerptRule = { mode: "paragraph" } | { mode: "words"; count: number };

export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/u).length;
}

export function sanitizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function lastWords(text: string, count: number): string {
  const words = text.split(/\s+/u).filter(Boolean);
  return words.slice(-count).join(" ");
}

export function extractExcerpt(text: string, rule: ExcerptRule): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean === "") return "";
  if (rule.mode === "words") return lastWords(clean, rule.count);
  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] ?? "";
  return countWords(last) > PARAGRAPH_EXCERPT_CAP ? lastWords(last, PARAGRAPH_EXCERPT_CAP) : last;
}
