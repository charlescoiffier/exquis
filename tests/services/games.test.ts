import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { game, notification, participant, turn } from "@/lib/db/schema";
import { MAX_ACTIVE_GAMES, MAX_CREATED_PER_DAY, createGame, getGameView, joinGame, listMyGames, listOpenGames } from "@/lib/services/games";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, drawingParams, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

describe("createGame", () => {
  it("crée la partie et inscrit le créateur", async () => {
    const u = await makeUser(db, "a");
    const { gameId } = await createGame(db, u, textParams(3));
    const ps = await db.select().from(participant).where(eq(participant.gameId, gameId));
    expect(ps.map((p) => p.userId)).toEqual([u]);
    const list = await listOpenGames(db);
    expect(list).toMatchObject([{ id: gameId, participantCount: 1, turns: 3, language: "fr" }]);
  });
  it.each([
    ["texte", textParams, "Texte de Alice"],
    ["dessin", drawingParams, "Dessin de Alice"],
  ])("génère le titre (%s) quand le nom est absent ou blanc, le conserve sinon", async (_l, mk, expected) => {
    const noName: Record<string, unknown> = { ...mk(3) };
    delete noName.name;
    const title = async (input: unknown) => {
      await resetDb(db);
      const id = await makeUser(db, "Alice");
      const { gameId } = await createGame(db, id, input);
      return (await db.select().from(game).where(eq(game.id, gameId)))[0].name;
    };
    expect(await title(noName)).toBe(expected);
    expect(await title({ ...noName, name: "   " })).toBe(expected);
    expect(await title({ ...noName, name: "" })).toBe(expected);
    expect(await title({ ...noName, name: "  Mon titre " })).toBe("Mon titre");
  });
  it("refuse des paramètres invalides", async () => {
    const u = await makeUser(db, "a");
    await expect(createGame(db, u, textParams(12))).rejects.toMatchObject({ code: "invalid_params" });
  });
  it("limite la création quotidienne", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_CREATED_PER_DAY; i++) {
      // chaque partie compte aussi pour la limite de parties actives : on les annule
      const { gameId } = await createGame(db, u, textParams(2));
      await db.update(game).set({ status: "cancelled" }).where(eq(game.id, gameId));
    }
    await expect(createGame(db, u, textParams(2))).rejects.toMatchObject({ code: "daily_limit" });
  });
});

describe("joinGame", () => {
  it("démarre la partie quand le dernier siège est pris", async () => {
    const { gameId, users } = await startedGame(db, textParams(3));
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("in_progress");
    const turns = await db.select().from(turn).where(eq(turn.gameId, gameId));
    expect(turns.map((t) => t.rank).sort()).toEqual([1, 2, 3]);
    expect(new Set(turns.map((t) => t.assignedUserId))).toEqual(new Set(users));
    const first = await activeTurn(db, gameId);
    expect(first.rank).toBe(1);
    expect(first.deadline!.getTime()).toBeGreaterThan(Date.now());
    const notes = await db.select().from(notification).where(and(eq(notification.gameId, gameId), eq(notification.type, "your_turn")));
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(first.assignedUserId);
  });
  it("renvoie les effets de planification au démarrage", async () => {
    const { effects } = await startedGame(db, textParams(2));
    expect(effects.map((e) => e.kind)).toEqual(expect.arrayContaining(["schedule-turn", "flush-notifications"]));
  });
  it("refuse une double inscription", async () => {
    const u = await makeUser(db, "a");
    const { gameId } = await createGame(db, u, textParams(3));
    await expect(joinGame(db, { userId: u, gameId })).rejects.toMatchObject({ code: "already_joined" });
  });
  it("deux joueurs sur le dernier siège : un seul réussit", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const c = await makeUser(db, "c");
    const { gameId } = await createGame(db, a, textParams(2));
    const results = await Promise.allSettled([joinGame(db, { userId: b, gameId }), joinGame(db, { userId: c, gameId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(["game_full", "game_not_open"]).toContain(rejected.reason.code);
    expect(await db.select().from(participant).where(eq(participant.gameId, gameId))).toHaveLength(2);
  });
  it("refuse de rejoindre une partie sur invitation sans jeton", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const { gameId } = await createGame(db, a, textParams(2, { visibility: "invite" }));
    await expect(joinGame(db, { userId: b, gameId })).rejects.toMatchObject({ code: "forbidden" });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    await expect(joinGame(db, { userId: b, gameId, token: g.inviteToken })).resolves.toMatchObject({ started: true });
  });
  it("limite les parties actives par joueur", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_ACTIVE_GAMES; i++) await createGame(db, u, textParams(2));
    await expect(createGame(db, u, textParams(2))).rejects.toMatchObject({ code: "active_limit" });
  });
  it("refuse de rejoindre une partie non ouverte", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const x = await makeUser(db, "x");
    await expect(joinGame(db, { userId: x, gameId })).rejects.toMatchObject({ code: "game_not_open" });
  });
});

describe("listMyGames / getGameView", () => {
  it("indique si c'est mon tour", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const active = await activeTurn(db, gameId);
    const mine = await listMyGames(db, active.assignedUserId);
    expect(mine).toMatchObject([{ id: gameId, status: "in_progress", isMyTurn: true }]);
  });
  it("masque le jeton d'invitation aux non-créateurs et protège les parties sur invitation", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const { gameId } = await createGame(db, a, textParams(3, { visibility: "invite" }));
    const viewA = await getGameView(db, { gameId, userId: a });
    expect(viewA.inviteToken).toBeTruthy();
    await expect(getGameView(db, { gameId, userId: b })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getGameView(db, { gameId, userId: b, token: viewA.inviteToken! })).resolves.toMatchObject({ inviteToken: null, isParticipant: false });
  });
});
