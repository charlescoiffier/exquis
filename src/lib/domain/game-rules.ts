import { z } from "zod";
import { DomainError } from "@/lib/errors";

export const MIN_TURNS = 2;
export const MAX_TURNS = 8;
export const MIN_DURATION = 30;
export const MAX_DURATION = 604800;

const base = z.object({
  name: z.string().trim().max(80).optional(),
  turns: z.number().int().min(MIN_TURNS).max(MAX_TURNS),
  turnDurationSeconds: z.number().int().min(MIN_DURATION).max(MAX_DURATION),
  visibility: z.enum(["public", "invite"]),
  turnLabels: z.array(z.string().trim().max(40)).max(MAX_TURNS).optional(),
});

const drawing = base.extend({
  type: z.literal("drawing"),
  direction: z.enum(["down", "right"]),
});

const text = base.extend({
  type: z.literal("text"),
  language: z.string().trim().min(2).max(10),
  minWords: z.number().int().min(1).max(2000),
  maxWords: z.number().int().min(1).max(2000),
  excerptMode: z.enum(["paragraph", "words"]),
  excerptWords: z.number().int().min(1).max(150).optional(),
});

export const gameParamsSchema = z
  .discriminatedUnion("type", [drawing, text])
  .superRefine((p, ctx) => {
    if (p.turnLabels && p.turnLabels.length !== p.turns) {
      ctx.addIssue({ code: "custom", message: "un intitulé (éventuellement vide) par tour", path: ["turnLabels"] });
    }
    if (p.type !== "text") return;
    if (p.minWords > p.maxWords) {
      ctx.addIssue({ code: "custom", message: "minWords doit être ≤ maxWords", path: ["minWords"] });
    }
    if (p.excerptMode === "words" && p.excerptWords === undefined) {
      ctx.addIssue({ code: "custom", message: "excerptWords requis", path: ["excerptWords"] });
    }
  });

export type GameParams = z.infer<typeof gameParamsSchema>;

export function parseGameParams(input: unknown): GameParams {
  const r = gameParamsSchema.safeParse(input);
  if (!r.success) {
    throw new DomainError("invalid_params", r.error.issues.map((i) => i.message).join("; "), 400);
  }
  return r.data;
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
