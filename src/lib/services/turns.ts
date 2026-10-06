import { and, asc, eq, lt } from "drizzle-orm";
import { SUBMIT_GRACE_MS, canActOnTurn } from "@/lib/access";
import type { Db, Tx } from "@/lib/db/client";
import { contribution, draft, game, participant, turn } from "@/lib/db/schema";
import { decideOnExpiry } from "@/lib/domain/expiry";
import { countWords, extractExcerpt, sanitizeText, type ExcerptRule } from "@/lib/domain/text";
import type { Effect } from "@/lib/effects";
import { DomainError } from "@/lib/errors";
import { extractStrip, inheritedZoneIntact, validateDrawingPng } from "@/lib/images/strip";
import type { Storage } from "@/lib/storage";
import { queueNotification } from "./notifications";
import { publicGame, type GameRow, type PublicGame } from "./games";

export const MAX_DRAFT_BYTES = 2_000_000;

export type MyTurn = {
  turnId: string;
  rank: number;
  total: number;
  deadline: Date;
  game: PublicGame;
  stripUrl?: string;
  excerpt?: string;
  draft: unknown | null;
};

type TurnRow = typeof turn.$inferSelect;

function excerptRule(g: GameRow): ExcerptRule {
  return g.excerptMode === "words" ? { mode: "words", count: g.excerptWords ?? 1 } : { mode: "paragraph" };
}

async function previousContribution(tx: Db | Tx, gameId: string, rank: number) {
  const [row] = await tx
    .select({ stripKey: contribution.stripKey, text: contribution.text })
    .from(contribution)
    .innerJoin(turn, eq(contribution.turnId, turn.id))
    .where(and(eq(turn.gameId, gameId), eq(turn.rank, rank - 1)));
  return row;
}

export async function getMyTurn(db: Db, storage: Storage, p: { userId: string; gameId: string; now?: Date }): Promise<MyTurn | null> {
  const now = p.now ?? new Date();
  const [t] = await db
    .select()
    .from(turn)
    .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")));
  if (!t || !canActOnTurn(t, p.userId, now)) return null;
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));

  let stripUrl: string | undefined;
  let excerpt: string | undefined;
  if (t.rank > 1) {
    const prev = await previousContribution(db, g.id, t.rank);
    if (g.type === "drawing" && prev?.stripKey) stripUrl = await storage.signedUrl(prev.stripKey, 300);
    if (g.type === "text" && prev?.text != null) excerpt = extractExcerpt(prev.text, excerptRule(g));
  }
  const [d] = await db.select().from(draft).where(and(eq(draft.turnId, t.id), eq(draft.userId, p.userId)));
  return { turnId: t.id, rank: t.rank, total: g.turns, deadline: t.deadline!, game: publicGame(g), stripUrl, excerpt, draft: d?.content ?? null };
}

async function finishTurn(tx: Tx, g: GameRow, t: TurnRow, now: Date): Promise<Effect[]> {
  await tx.update(turn).set({ status: "done" }).where(eq(turn.id, t.id));
  await tx.delete(draft).where(eq(draft.turnId, t.id));

  if (t.rank >= g.turns) {
    await tx.update(game).set({ status: "completed", completedAt: now }).where(eq(game.id, g.id));
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    for (const p of ps) await queueNotification(tx, { userId: p.userId, type: "game_completed", gameId: g.id });
    return [{ kind: "finalize-game", gameId: g.id }, { kind: "flush-notifications" }];
  }

  const [next] = await tx
    .select()
    .from(turn)
    .where(and(eq(turn.gameId, g.id), eq(turn.rank, t.rank + 1)))
    .for("update");
  const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
  await tx.update(turn).set({ status: "active", startedAt: now, deadline }).where(eq(turn.id, next.id));
  await queueNotification(tx, { userId: next.assignedUserId!, type: "your_turn", gameId: g.id, turnId: next.id });
  return [
    { kind: "schedule-turn", turnId: next.id, deadline, durationSeconds: g.turnDurationSeconds },
    { kind: "flush-notifications" },
  ];
}

type Content = { text?: string; imageKey?: string; stripKey?: string };

async function submit(
  db: Db,
  p: { userId: string; gameId: string; now?: Date },
  build: (tx: Tx, g: GameRow, t: TurnRow) => Promise<Content>,
): Promise<Effect[]> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(turn)
      .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")))
      .for("update");
    if (!t || !canActOnTurn(t, p.userId, now)) throw new DomainError("not_your_turn", "Ce n'est pas votre tour.", 409);
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId));
    const content = await build(tx, g, t);
    await tx.insert(contribution).values({ turnId: t.id, userId: p.userId, ...content });
    return finishTurn(tx, g, t, now);
  });
}

export async function submitText(db: Db, p: { userId: string; gameId: string; text: string; now?: Date }): Promise<Effect[]> {
  return submit(db, p, async (_tx, g) => {
    if (g.type !== "text") throw new DomainError("wrong_type", "Cette partie n'est pas une partie de texte.", 400);
    const text = sanitizeText(p.text).trim();
    const words = countWords(text);
    if (words < g.minWords! || words > g.maxWords!) {
      throw new DomainError("invalid_text", `Le texte doit contenir entre ${g.minWords} et ${g.maxWords} mots.`, 400);
    }
    return { text };
  });
}

export async function submitDrawing(
  db: Db,
  storage: Storage,
  p: { userId: string; gameId: string; png: Buffer; now?: Date },
): Promise<Effect[]> {
  return submit(db, p, async (tx, g, t) => {
    if (g.type !== "drawing") throw new DomainError("wrong_type", "Cette partie n'est pas une partie de dessin.", 400);
    const d = g.direction!;
    await validateDrawingPng(p.png, d);
    if (t.rank > 1) {
      const prev = await previousContribution(tx, g.id, t.rank);
      if (!prev?.stripKey) throw new DomainError("invalid_image", "Bande héritée introuvable.", 500);
      if (!(await inheritedZoneIntact(p.png, await storage.get(prev.stripKey), d))) {
        throw new DomainError("invalid_image", "La zone héritée ne doit pas être modifiée.", 400);
      }
    }
    const strip = await extractStrip(p.png, d);
    const base = `games/${g.id}/turns/${t.rank}`;
    await storage.put(`${base}/full.png`, p.png, "image/png");
    await storage.put(`${base}/strip.png`, strip, "image/png");
    return { imageKey: `${base}/full.png`, stripKey: `${base}/strip.png` };
  });
}

export async function saveDraft(db: Db, p: { userId: string; gameId: string; content: unknown; now?: Date }): Promise<void> {
  const now = p.now ?? new Date();
  let json: string | undefined;
  try {
    json = JSON.stringify(p.content);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new DomainError("invalid_draft", "Brouillon invalide.", 400);
  if (Buffer.byteLength(json) > MAX_DRAFT_BYTES) throw new DomainError("draft_too_large", "Brouillon trop volumineux.", 413);
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(turn)
      .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")))
      .for("update");
    if (!t || !canActOnTurn(t, p.userId, now)) throw new DomainError("not_your_turn", "Ce n'est pas votre tour.", 409);
    await tx
      .insert(draft)
      .values({ turnId: t.id, userId: p.userId, content: p.content as object, updatedAt: now })
      .onConflictDoUpdate({ target: draft.turnId, set: { userId: p.userId, content: p.content as object, updatedAt: now } });
  });
}

export async function expireTurn(db: Db, p: { turnId: string; deadline: Date; now?: Date }): Promise<Effect[]> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(turn).where(eq(turn.id, p.turnId)).for("update");
    if (!t || t.status !== "active" || !t.deadline) return [];
    if (t.deadline.getTime() !== p.deadline.getTime()) return [];
    if (now.getTime() < t.deadline.getTime() + SUBMIT_GRACE_MS) return [];

    const [g] = await tx.select().from(game).where(eq(game.id, t.gameId));
    const pending = await tx
      .select({ id: turn.id, rank: turn.rank, assignedUserId: turn.assignedUserId })
      .from(turn)
      .where(and(eq(turn.gameId, g.id), eq(turn.status, "pending")))
      .orderBy(asc(turn.rank));
    const decision = decideOnExpiry({ attempts: t.attempts, pending });

    if (decision.kind === "open_call") {
      // Dernier tour : la partie continue, le tour est proposé à tous (appel à participation).
      await tx
        .update(turn)
        .set({ status: "open_call", assignedUserId: null, deadline: null, startedAt: null, attempts: t.attempts + 1 })
        .where(eq(turn.id, t.id));
      await tx.delete(draft).where(eq(draft.turnId, t.id));
      await queueNotification(tx, { userId: t.assignedUserId!, type: "turn_reassigned", gameId: g.id, turnId: t.id, suffix: String(t.attempts + 1) });
      return [{ kind: "flush-notifications" }];
    }

    if (decision.kind === "cancel") {
      await tx.update(turn).set({ status: "expired" }).where(eq(turn.id, t.id));
      await tx.update(game).set({ status: "cancelled" }).where(eq(game.id, g.id));
      const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
      for (const part of ps) await queueNotification(tx, { userId: part.userId, type: "game_cancelled", gameId: g.id });
      return [{ kind: "flush-notifications" }];
    }

    const target = pending.find((x) => x.id === decision.withTurnId)!;
    const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
    await tx.update(turn).set({ assignedUserId: target.assignedUserId, attempts: t.attempts + 1, startedAt: now, deadline }).where(eq(turn.id, t.id));
    await tx.update(turn).set({ assignedUserId: t.assignedUserId }).where(eq(turn.id, target.id));
    await tx.delete(draft).where(eq(draft.turnId, t.id));
    const suffix = String(t.attempts + 1);
    await queueNotification(tx, { userId: target.assignedUserId!, type: "your_turn", gameId: g.id, turnId: t.id, suffix });
    await queueNotification(tx, { userId: t.assignedUserId!, type: "turn_reassigned", gameId: g.id, turnId: t.id, suffix });
    return [
      { kind: "schedule-turn", turnId: t.id, deadline, durationSeconds: g.turnDurationSeconds },
      { kind: "flush-notifications" },
    ];
  });
}

/** Filet de sécurité : expire tous les tours dont l'échéance + tolérance est dépassée. */
export async function expireOverdue(db: Db, now = new Date()): Promise<Effect[]> {
  const overdue = await db
    .select({ id: turn.id, deadline: turn.deadline })
    .from(turn)
    .where(and(eq(turn.status, "active"), lt(turn.deadline, new Date(now.getTime() - SUBMIT_GRACE_MS))));
  const effects: Effect[] = [];
  for (const t of overdue) {
    try {
      effects.push(...(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now })));
    } catch (err) {
      console.error(`expireOverdue: échec pour le tour ${t.id}`, err);
    }
  }
  return effects;
}
