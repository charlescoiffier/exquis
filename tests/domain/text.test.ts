import { describe, expect, it } from "vitest";
import { countWords, extractExcerpt, sanitizeText, transmittedRange, PARAGRAPH_EXCERPT_CAP, type ExcerptRule } from "@/lib/domain/text";

describe("countWords", () => {
  it("compte les mots séparés par des espaces multiples et sauts de ligne", () => {
    expect(countWords("  un  deux\n\ntrois  ")).toBe(3);
  });
  it("renvoie 0 pour un texte vide ou fait d'espaces", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });
  it("gère les accents ; un emoji seul n'est pas un mot", () => {
    expect(countWords("été à Noël 🎄 ok")).toBe(4);
  });
  it("ignore la ponctuation et les emoji seuls", () => {
    expect(countWords("Bonjour , monde !")).toBe(2);
    expect(countWords("... — !!")).toBe(0);
    expect(countWords("🎄 🎄")).toBe(0);
  });
  it("garde les mots à apostrophe ou trait d'union d'un seul bloc", () => {
    expect(countWords("l'été, c'est-à-dire")).toBe(2);
  });
});

describe("sanitizeText", () => {
  it("normalise les fins de ligne et retire les caractères de contrôle", () => {
    expect(sanitizeText("a\r\nb\u0000c")).toBe("a\nbc");
  });
  it("traite U+0085, U+2028 et U+2029 comme des sauts de ligne", () => {
    expect(sanitizeText("a\u0085b\u2028c\u2029d")).toBe("a\nb\nc\nd");
    expect(extractExcerpt(sanitizeText("a\u2028b c"), { mode: "paragraph" })).toBe("b c");
  });
});

describe("extractExcerpt", () => {
  it("renvoie la dernière ligne non vide (un paragraphe = une ligne)", () => {
    expect(extractExcerpt("a\nb\nc", { mode: "paragraph" })).toBe("c");
    expect(extractExcerpt("Premier.\n\nSecond.\n\nTroisième.", { mode: "paragraph" })).toBe("Troisième.");
  });
  it("ignore les lignes vides finales", () => {
    expect(extractExcerpt("a\nb\n\n  \n", { mode: "paragraph" })).toBe("b");
  });
  it("renvoie les X derniers mots", () => {
    expect(extractExcerpt("a b c d e", { mode: "words", count: 2 })).toBe("d e");
  });
  it("plafonne un paragraphe unique trop long", () => {
    const text = Array.from({ length: 400 }, (_, i) => `m${i}`).join(" ");
    const excerpt = extractExcerpt(text, { mode: "paragraph" });
    expect(countWords(excerpt)).toBe(PARAGRAPH_EXCERPT_CAP);
    expect(excerpt.endsWith("m399")).toBe(true);
  });
  it("renvoie une chaîne vide pour un texte vide", () => {
    expect(extractExcerpt("   ", { mode: "paragraph" })).toBe("");
  });
});

const lastLineLength = (t: string) => countWords(t.split(/[\r\n]+/).filter((l) => l.trim()).pop() ?? "");

describe("transmittedRange", () => {
  const cases: [string, string, ExcerptRule][] = [
    ["trois lignes", "un\ndeux\ntrois", { mode: "paragraph" }],
    ["CRLF", "un\r\ndeux\r\ntrois mots ici\r\n", { mode: "paragraph" }],
    ["lignes vides et espaces", "  un  \n\n   \n  deux  trois  \n\n  \n", { mode: "paragraph" }],
    ["une seule ligne", "  seul paragraphe  ", { mode: "paragraph" }],
    ["dernier paragraphe trop long", "début\n" + Array.from({ length: 400 }, (_, i) => `m${i}`).join("  "), { mode: "paragraph" }],
    ["mots", "a b\nc  d\r\ne", { mode: "words", count: 2 }],
    ["mots, count > nombre de mots", "a b", { mode: "words", count: 10 }],
    ["mots avec ponctuation", "Salut , le monde !  ", { mode: "words", count: 3 }],
  ];
  it.each(cases)("%s : la tranche correspond à l'extrait", (_l, text, rule) => {
    const { start, end } = transmittedRange(text, rule);
    const slice = text.slice(start, end);
    // Pas d'espace en bordure de la plage.
    expect(slice).toBe(slice.trim());
    // Paragraphe non plafonné : l'extrait est exactement la tranche.
    // Mode mots ou paragraphe plafonné : la tranche, espaces internes réduits à un seul.
    const collapsed = rule.mode === "words" || lastLineLength(text) > PARAGRAPH_EXCERPT_CAP;
    expect(extractExcerpt(text, rule)).toBe(collapsed ? slice.replace(/\s+/g, " ") : slice);
  });
  it("mots avec ponctuation : compte exactement count mots", () => {
    expect(extractExcerpt("Salut , le monde !", { mode: "words", count: 3 })).toBe("Salut , le monde !");
    expect(countWords(extractExcerpt("Salut , le monde !", { mode: "words", count: 2 }))).toBe(2);
  });
  it.each([
    ["Fin du texte ! 🎄", 2, "texte ! 🎄"],
    ["a , b ... c — d !!", 3, "b ... c — d !!"],
    ["un deux", 5, "un deux"],
    ["... 🎄 !!", 2, ""],
    ["", 2, ""],
  ])("mode mots %j count=%i : exactement min(count, mots) mots", (text, count, expected) => {
    const ex = extractExcerpt(text, { mode: "words", count });
    expect(ex).toBe(expected);
    expect(countWords(ex)).toBe(Math.min(count, countWords(text)));
    const { start, end } = transmittedRange(text, { mode: "words", count });
    expect(text.slice(start, end).replace(/\s+/g, " ")).toBe(expected);
  });
  it("ligne plafonnée avec ponctuation intercalée : exactement 150 mots", () => {
    const t = Array.from({ length: 200 }, (_, i) => `m${i} ,`).join(" ");
    const ex = extractExcerpt(t, { mode: "paragraph" });
    expect(countWords(ex)).toBe(PARAGRAPH_EXCERPT_CAP);
    expect(ex.startsWith("m50 ")).toBe(true);
    expect(ex.endsWith("m199 ,")).toBe(true);
  });
  it("texte vide ou blanc : plage vide", () => {
    expect(transmittedRange("", { mode: "paragraph" })).toEqual({ start: 0, end: 0 });
    expect(transmittedRange("  \n ", { mode: "words", count: 3 })).toEqual({ start: 0, end: 0 });
  });
  it("trois lignes : plage de la dernière", () => {
    const t = "un\ndeux\ntrois";
    expect(transmittedRange(t, { mode: "paragraph" })).toEqual({ start: 8, end: 13 });
  });
  it("mots count=2 : du premier de ces mots à la fin du dernier", () => {
    const t = "a b c d";
    expect(transmittedRange(t, { mode: "words", count: 2 })).toEqual({ start: 4, end: 7 });
  });
  it("dernier paragraphe long : plafonné aux 150 derniers mots", () => {
    const t = Array.from({ length: 400 }, (_, i) => `m${i}`).join(" ");
    const { start, end } = transmittedRange(t, { mode: "paragraph" });
    expect(t.slice(start, end).split(" ")).toHaveLength(PARAGRAPH_EXCERPT_CAP);
    expect(end).toBe(t.length);
  });
  it("les indices restent cohérents après sanitizeText côté client", () => {
    const raw = "a\r\nb\r\nc d";
    const t = sanitizeText(raw);
    const { start, end } = transmittedRange(t, { mode: "paragraph" });
    expect(t.slice(start, end)).toBe("c d");
  });
});
