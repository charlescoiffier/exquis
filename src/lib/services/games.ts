import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db, Executor, Tx } from "@/lib/db/client";
import { game, participant, turn } from "@/lib/db/schema";
import { parseGameParams, shuffle } from "@/lib/domain/game-rules";
import type { Effect } from "@/lib/effects";
import { DomainError } from "@/lib/errors";
import { queueNotification } from "./notifications";

export const MAX_ACTIVE_GAMES = 5;
export const MAX_CREATED_PER_DAY = 10;

export type GameRow = typeof game.$inferSelect;
export type PublicGame = Omit<GameRow, "inviteToken">;

export function publicGame(g: GameRow): PublicGame {
  const { inviteToken: _omit, ...rest } = g;
  return rest;
}

async function activeGameCount(tx: Executor, userId: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .where(and(eq(participant.userId, userId), inArray(game.status, ["open", "in_progress"])));
  return n;
}

export async function createGame(db: Db, creatorId: string, input: unknown, now = new Date()): Promise<{ gameId: string }> {
  const p = parseGameParams(input);
  return db.transaction(async (tx) => {
    const [{ n: createdToday }] = await tx
      .select({ n: count() })
      .from(game)
      .where(and(eq(game.creatorId, creatorId), gt(game.createdAt, new Date(now.getTime() - 86400_000))));
    if (createdToday >= MAX_CREATED_PER_DAY) throw new DomainError("daily_limit", "Limite quotidienne de parties créées atteinte.", 429);
    if ((await activeGameCount(tx, creatorId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    const [g] = await tx
      .insert(game)
      .values({
        creatorId,
        name: p.name,
        type: p.type,
        turns: p.turns,
        turnDurationSeconds: p.turnDurationSeconds,
        visibility: p.visibility,
        inviteToken: randomBytes(16).toString("hex"),
        direction: p.type === "drawing" ? p.direction : null,
        language: p.type === "text" ? p.language : null,
        minWords: p.type === "text" ? p.minWords : null,
        maxWords: p.type === "text" ? p.maxWords : null,
        excerptMode: p.type === "text" ? p.excerptMode : null,
        excerptWords: p.type === "text" && p.excerptMode === "words" ? p.excerptWords! : null,
        createdAt: now,
      })
      .returning({ id: game.id });
    await tx.insert(participant).values({ gameId: g.id, userId: creatorId });
    return { gameId: g.id };
  });
}

async function startGame(tx: Tx, g: GameRow, now: Date, rand?: () => number): Promise<Effect[]> {
  const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
  const order = shuffle(ps, rand);
  const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
  let firstTurnId = "";
  for (let i = 0; i < order.length; i++) {
    await tx.update(participant).set({ rank: i + 1 }).where(eq(participant.id, order[i].id));
    const [t] = await tx
      .insert(turn)
      .values({
        gameId: g.id,
        rank: i + 1,
        assignedUserId: order[i].userId,
        status: i === 0 ? "active" : "pending",
        startedAt: i === 0 ? now : null,
        deadline: i === 0 ? deadline : null,
      })
      .returning({ id: turn.id });
    if (i === 0) firstTurnId = t.id;
  }
  await tx.update(game).set({ status: "in_progress", startedAt: now }).where(eq(game.id, g.id));
  for (const p of ps) await queueNotification(tx, { userId: p.userId, type: "game_started", gameId: g.id });
  await queueNotification(tx, { userId: order[0].userId, type: "your_turn", gameId: g.id, turnId: firstTurnId });
  return [
    { kind: "schedule-turn", turnId: firstTurnId, deadline, durationSeconds: g.turnDurationSeconds },
    { kind: "flush-notifications" },
  ];
}

const inflightJoins = new Map<string, number>();

export async function joinGame(
  db: Db,
  p: { userId: string; gameId: string; token?: string; now?: Date; rand?: () => number },
): Promise<{ started: boolean; effects: Effect[] }> {
  const now = p.now ?? new Date();
  // Un join concurrent déjà en cours sur la même partie (même processus) : si la partie
  // s'est fermée entre-temps, le dernier siège nous a été pris -> "game_full" plutôt que "game_not_open".
  const contended = (inflightJoins.get(p.gameId) ?? 0) > 0;
  inflightJoins.set(p.gameId, (inflightJoins.get(p.gameId) ?? 0) + 1);
  try {
    return await joinGameTx(db, p, now, contended);
  } finally {
    const left = (inflightJoins.get(p.gameId) ?? 1) - 1;
    if (left <= 0) inflightJoins.delete(p.gameId);
    else inflightJoins.set(p.gameId, left);
  }
}

async function joinGameTx(
  db: Db,
  p: { userId: string; gameId: string; token?: string; rand?: () => number },
  now: Date,
  contended: boolean,
): Promise<{ started: boolean; effects: Effect[] }> {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId)).for("update");
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    if (g.status !== "open") {
      if (contended) throw new DomainError("game_full", "La partie est complète.", 409);
      throw new DomainError("game_not_open", "Cette partie n'accepte plus de joueurs.", 409);
    }
    if (g.visibility === "invite" && g.creatorId !== p.userId && p.token !== g.inviteToken) {
      throw new DomainError("forbidden", "Invitation requise.", 403);
    }
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    if (ps.some((x) => x.userId === p.userId)) throw new DomainError("already_joined", "Vous participez déjà.", 409);
    if (ps.length >= g.turns) throw new DomainError("game_full", "La partie est complète.", 409);
    if ((await activeGameCount(tx, p.userId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    await tx.insert(participant).values({ gameId: g.id, userId: p.userId });
    if (ps.length + 1 === g.turns) {
      return { started: true, effects: await startGame(tx, g, now, p.rand) };
    }
    return { started: false, effects: [] };
  });
}

export async function listOpenGames(db: Db) {
  return db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      language: game.language,
      participantCount: count(participant.id),
    })
    .from(game)
    .leftJoin(participant, eq(participant.gameId, game.id))
    .where(and(eq(game.status, "open"), eq(game.visibility, "public")))
    .groupBy(game.id)
    .orderBy(desc(game.createdAt));
}

export async function listMyGames(db: Db, userId: string) {
  const rows = await db
    .select({ id: game.id, name: game.name, type: game.type, status: game.status, turns: game.turns, activeTurnId: turn.id })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .leftJoin(turn, and(eq(turn.gameId, game.id), eq(turn.status, "active"), eq(turn.assignedUserId, userId)))
    .where(eq(participant.userId, userId))
    .orderBy(desc(game.createdAt));
  return rows.map(({ activeTurnId, ...r }) => ({ ...r, isMyTurn: activeTurnId !== null }));
}

export async function listOpenCalls(db: Db) {
  return db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      language: game.language,
      rank: turn.rank,
    })
    .from(turn)
    .innerJoin(game, eq(turn.gameId, game.id))
    .where(and(eq(turn.status, "open_call"), eq(game.status, "in_progress"), eq(game.visibility, "public")))
    .orderBy(desc(game.createdAt));
}

/** Un volontaire (non participant) reprend le tour laissé vacant. */
export async function claimOpenCall(
  db: Db,
  p: { userId: string; gameId: string; token?: string; now?: Date },
): Promise<{ effects: Effect[] }> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId)).for("update");
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    if (g.status !== "in_progress") throw new DomainError("open_call_unavailable", "Aucun tour disponible.", 409);
    if (g.visibility === "invite" && g.creatorId !== p.userId && p.token !== g.inviteToken) {
      throw new DomainError("forbidden", "Invitation requise.", 403);
    }
    const [t] = await tx
      .select()
      .from(turn)
      .where(and(eq(turn.gameId, g.id), eq(turn.status, "open_call")))
      .for("update");
    if (!t) throw new DomainError("open_call_unavailable", "Ce tour a déjà été repris.", 409);
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    if (ps.some((x) => x.userId === p.userId)) throw new DomainError("already_joined", "Vous participez déjà à cette partie.", 409);
    if ((await activeGameCount(tx, p.userId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
    await tx.insert(participant).values({ gameId: g.id, userId: p.userId, rank: t.rank });
    await tx.update(turn).set({ assignedUserId: p.userId, status: "active", startedAt: now, deadline }).where(eq(turn.id, t.id));
    await queueNotification(tx, { userId: p.userId, type: "your_turn", gameId: g.id, turnId: t.id, suffix: `open-${t.attempts}` });
    return {
      effects: [
        { kind: "schedule-turn", turnId: t.id, deadline, durationSeconds: g.turnDurationSeconds },
        { kind: "flush-notifications" },
      ],
    };
  });
}

export type GameView = {
  game: PublicGame;
  participantCount: number;
  isParticipant: boolean;
  isCreator: boolean;
  inviteToken: string | null;
  openCall: boolean;
};

export async function getGameView(db: Db, p: { gameId: string; userId: string; token?: string }): Promise<GameView> {
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const ps = await db.select().from(participant).where(eq(participant.gameId, g.id));
  const isParticipant = ps.some((x) => x.userId === p.userId);
  const isCreator = g.creatorId === p.userId;
  if (g.visibility === "invite" && !isParticipant && !isCreator && p.token !== g.inviteToken) {
    throw new DomainError("forbidden", "Invitation requise.", 403);
  }
  const [open] = await db
    .select({ id: turn.id })
    .from(turn)
    .where(and(eq(turn.gameId, g.id), eq(turn.status, "open_call")));
  return {
    game: publicGame(g),
    participantCount: ps.length,
    isParticipant,
    isCreator,
    inviteToken: isCreator ? g.inviteToken : null,
    openCall: !!open,
  };
}
