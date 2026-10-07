import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db, Executor, Tx } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
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

    let name = p.name;
    if (!name) {
      const [creator] = await tx.select({ name: user.name }).from(user).where(eq(user.id, creatorId));
      name = `${p.type === "text" ? "Texte" : "Dessin"} de ${creator?.name ?? "anonyme"}`;
    }

    const [g] = await tx
      .insert(game)
      .values({
        creatorId,
        name,
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
        turnLabels: p.turnLabels?.some((l) => l !== "") ? p.turnLabels : null,
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

export async function joinGame(
  db: Db,
  p: { userId: string; gameId: string; token?: string; now?: Date; rand?: () => number },
): Promise<{ started: boolean; effects: Effect[] }> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId)).for("update");
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    if (g.status !== "open") throw new DomainError("game_not_open", "Cette partie n'accepte plus de joueurs.", 409);
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

export const PAGE_SIZE = 12;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

/** Numéro de page demandé (paramètre d'URL) : entier ≥ 1, 1 par défaut. */
export function parsePage(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function pageWindow(total: number, requested: number) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, offset: (page - 1) * PAGE_SIZE };
}

const participantCountSql = sql<number>`(select count(*)::int from participant pp where pp.game_id = ${game.id})`;

const listColumns = {
  id: game.id,
  name: game.name,
  type: game.type,
  status: game.status,
  turns: game.turns,
  turnDurationSeconds: game.turnDurationSeconds,
  language: game.language,
  createdAt: game.createdAt,
  completedAt: game.completedAt,
  creatorName: user.name,
  participantCount: participantCountSql,
};

/** Parties ouvertes publiques, les plus anciennes d'abord. */
export async function listOpenGames(db: Db, p: { page?: number } = {}): Promise<Page<{ id: string; name: string; type: "drawing" | "text"; turns: number; turnDurationSeconds: number; language: string | null; creatorName: string; participantCount: number; createdAt: Date }>> {
  const where = and(eq(game.status, "open"), eq(game.visibility, "public"));
  const [{ n: total }] = await db.select({ n: count() }).from(game).where(where);
  const w = pageWindow(total, p.page ?? 1);
  const items = await db
    .select({
      id: listColumns.id,
      name: listColumns.name,
      type: listColumns.type,
      turns: listColumns.turns,
      turnDurationSeconds: listColumns.turnDurationSeconds,
      language: listColumns.language,
      creatorName: listColumns.creatorName,
      participantCount: listColumns.participantCount,
      createdAt: listColumns.createdAt,
    })
    .from(game)
    .innerJoin(user, eq(user.id, game.creatorId))
    .where(where)
    .orderBy(asc(game.createdAt))
    .limit(PAGE_SIZE)
    .offset(w.offset);
  return { items, total, page: w.page, pageSize: PAGE_SIZE, pageCount: w.pageCount };
}

/** Parties de l'utilisateur en attente de joueurs ou en cours ; celles où c'est son tour d'abord, puis les plus anciennes. */
export async function listMyCurrentGames(db: Db, userId: string, p: { page?: number } = {}) {
  const where = and(eq(participant.userId, userId), inArray(game.status, ["open", "in_progress"]));
  const [{ n: total }] = await db
    .select({ n: count() })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .where(where);
  const w = pageWindow(total, p.page ?? 1);
  const rows = await db
    .select({ ...listColumns, activeTurnId: turn.id })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .innerJoin(user, eq(user.id, game.creatorId))
    .leftJoin(turn, and(eq(turn.gameId, game.id), eq(turn.status, "active"), eq(turn.assignedUserId, userId)))
    .where(where)
    .orderBy(desc(sql`(${turn.id} is not null)`), asc(game.createdAt))
    .limit(PAGE_SIZE)
    .offset(w.offset);
  const items = rows.map(({ activeTurnId, ...r }) => ({ ...r, isMyTurn: activeTurnId !== null }));
  return { items, total, page: w.page, pageSize: PAGE_SIZE, pageCount: w.pageCount } satisfies Page<(typeof items)[number]>;
}

/** Identifiants de toutes les parties en cours (ou en attente de joueurs) de l'utilisateur. */
export async function listMyCurrentGameIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: game.id })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .where(and(eq(participant.userId, userId), inArray(game.status, ["open", "in_progress"])));
  return new Set(rows.map((r) => r.id));
}

/** Parties terminées ou annulées de l'utilisateur, les plus récentes d'abord. */
export async function listMyPastGames(db: Db, userId: string, p: { page?: number } = {}) {
  const where = and(eq(participant.userId, userId), inArray(game.status, ["completed", "cancelled"]));
  const [{ n: total }] = await db
    .select({ n: count() })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .where(where);
  const w = pageWindow(total, p.page ?? 1);
  const items = await db
    .select(listColumns)
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .innerJoin(user, eq(user.id, game.creatorId))
    .where(where)
    .orderBy(desc(sql`coalesce(${game.completedAt}, ${game.createdAt})`))
    .limit(PAGE_SIZE)
    .offset(w.offset);
  return { items, total, page: w.page, pageSize: PAGE_SIZE, pageCount: w.pageCount } satisfies Page<(typeof items)[number]>;
}

/** Parties publiques en cours dont le dernier tour attend un volontaire, les plus anciennes d'abord. */
export async function listOpenCalls(db: Db, p: { page?: number } = {}) {
  const where = and(eq(turn.status, "open_call"), eq(game.status, "in_progress"), eq(game.visibility, "public"));
  const [{ n: total }] = await db.select({ n: count() }).from(turn).innerJoin(game, eq(turn.gameId, game.id)).where(where);
  const w = pageWindow(total, p.page ?? 1);
  const items = await db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      language: game.language,
      creatorName: user.name,
      rank: turn.rank,
      createdAt: game.createdAt,
    })
    .from(turn)
    .innerJoin(game, eq(turn.gameId, game.id))
    .innerJoin(user, eq(user.id, game.creatorId))
    .where(where)
    .orderBy(asc(game.createdAt))
    .limit(PAGE_SIZE)
    .offset(w.offset);
  return { items, total, page: w.page, pageSize: PAGE_SIZE, pageCount: w.pageCount } satisfies Page<(typeof items)[number]>;
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
  creatorName: string;
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
  const [creator] = await db.select({ name: user.name }).from(user).where(eq(user.id, g.creatorId));
  return {
    game: publicGame(g),
    creatorName: creator?.name ?? "",
    participantCount: ps.length,
    isParticipant,
    isCreator,
    inviteToken: isCreator ? g.inviteToken : null,
    openCall: !!open,
  };
}
