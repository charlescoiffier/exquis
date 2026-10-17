import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { draft, game, notification, participant, turn } from "@/lib/db/schema";
import { STALE_GAME_MS, purgeStaleGames, MAX_ACTIVE_GAMES, MAX_CREATED_PER_DAY, createGame, getGameView, joinGame, listJoinableGames, listMyCurrentGames, listMyPastGames, listOpenGames, PAGE_SIZE, parsePage } from "@/lib/services/games";
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
    expect(list.items).toMatchObject([{ id: gameId, participantCount: 1, turns: 3, language: "fr", creatorName: expect.any(String) }]);
    expect(list).toMatchObject({ total: 1, page: 1, pageCount: 1, pageSize: PAGE_SIZE });
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

describe("listMyCurrentGames / getGameView", () => {
  it("indique si c'est mon tour", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const active = await activeTurn(db, gameId);
    const mine = await listMyCurrentGames(db, active.assignedUserId);
    expect(mine.items).toMatchObject([{ id: gameId, status: "in_progress", isMyTurn: true }]);
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

describe("intitulés de tours", () => {
  it("stocke les intitulés s'il y en a au moins un, sinon rien", async () => {
    const u = await makeUser(db, "a");
    const { gameId } = await createGame(db, u, textParams(3, { turnLabels: ["Début", "", "Fin"] }));
    expect((await db.select().from(game).where(eq(game.id, gameId)))[0].turnLabels).toEqual(["Début", "", "Fin"]);
    const { gameId: g2 } = await createGame(db, u, textParams(2, { turnLabels: ["", ""] }));
    expect((await db.select().from(game).where(eq(game.id, g2)))[0].turnLabels).toBeNull();
  });
  it("refuse un nombre d'intitulés différent du nombre de tours", async () => {
    const u = await makeUser(db, "a");
    await expect(createGame(db, u, textParams(3, { turnLabels: ["a", "b"] }))).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("purge des parties sans activité", () => {
  it("supprime les parties en attente ou en cours sans activité depuis une semaine, pas les autres", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - STALE_GAME_MS - 60_000);
    const recent = new Date(now.getTime() - STALE_GAME_MS + 3600_000);
    const u = await makeUser(db, "p");
    await createGame(db, u, textParams(2, { name: "attente ancienne" }), old);
    await createGame(db, u, textParams(2, { name: "attente récente" }), recent);
    await startedGame(db, textParams(2, { name: "en cours inactive" }), old);
    await startedGame(db, textParams(2, { name: "en cours récente" }), recent);
    // En cours, lancée il y a longtemps, mais un brouillon a été enregistré récemment : la partie est active.
    const lively = await startedGame(db, textParams(2, { name: "en cours active" }), old);
    const t = await activeTurn(db, lively.gameId);
    await db.insert(draft).values({ turnId: t.id, userId: t.assignedUserId, content: { text: "un deux" }, updatedAt: new Date(now.getTime() - 3600_000) });
    expect(await purgeStaleGames(db, now)).toBe(2);
    const names = (await db.select({ n: game.name }).from(game)).map((g) => g.n).sort();
    expect(names).toEqual(["attente récente", "en cours active", "en cours récente"]);
  });
});

describe("joueurs inscrits", () => {
  it("les listes et la vue d'une partie en attente donnent les inscrits par ordre d'inscription ; rien une fois la partie lancée", async () => {
    const [a, b, c] = [await makeUser(db, "alice"), await makeUser(db, "bastien"), await makeUser(db, "chloe")];
    const { gameId } = await createGame(db, a, textParams(3, { name: "En attente" }));
    await joinGame(db, { userId: b, gameId });
    expect((await listOpenGames(db)).items[0].players).toEqual(["alice", "bastien"]);
    expect((await listJoinableGames(db, { userId: c })).items[0].players).toEqual(["alice", "bastien"]);
    expect((await listMyCurrentGames(db, a)).items[0].players).toEqual(["alice", "bastien"]);
    expect((await getGameView(db, { gameId, userId: b })).players).toEqual(["alice", "bastien"]);
    await joinGame(db, { userId: c, gameId });
    expect((await listMyCurrentGames(db, a)).items[0].players).toEqual([]);
    expect((await getGameView(db, { gameId, userId: a })).players).toEqual([]);
  });
});

describe("thème", () => {
  it("est enregistré, exposé dans les listes et la vue de la partie, et facultatif", async () => {
    const u = await makeUser(db, "t");
    const { gameId } = await createGame(db, u, textParams(2, { theme: "Un dragon timide" }));
    const other = await makeUser(db, "t2");
    await createGame(db, other, textParams(2, { name: "sans thème" }));
    const open = await listOpenGames(db);
    expect(open.items.map((g) => [g.name, g.theme]).sort()).toEqual([["Texte", "Un dragon timide"], ["sans thème", null]]);
    expect((await getGameView(db, { gameId, userId: u })).game.theme).toBe("Un dragon timide");
  });
});

describe("listes paginées", () => {
  it("parsePage tolère les valeurs invalides", () => {
    expect([parsePage(undefined), parsePage("0"), parsePage("abc"), parsePage("3"), parsePage(["2", "5"])]).toEqual([1, 1, 1, 3, 2]);
  });
  it("parties ouvertes : 8 par page, les plus récentes d'abord, créateur indiqué", async () => {
    const t0 = Date.now() - 100_000;
    for (let i = 0; i < PAGE_SIZE + 1; i++) {
      const u = await makeUser(db, `c${i}`);
      await createGame(db, u, textParams(2, { name: `g${String(i).padStart(2, "0")}` }), new Date(t0 + i * 1000));
    }
    const p1 = await listOpenGames(db, { page: 1 });
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.items[0].name).toBe(`g${String(PAGE_SIZE).padStart(2, "0")}`);
    expect(p1.items[0].creatorName).toBe(`c${PAGE_SIZE}`);
    expect(p1).toMatchObject({ total: PAGE_SIZE + 1, pageCount: 2 });
    const p2 = await listOpenGames(db, { page: 2 });
    expect(p2.items.map((g) => g.name)).toEqual(["g00"]);
    expect((await listOpenGames(db, { page: 99 })).page).toBe(2);
  });
  it("mes parties en cours / anciennes : séparées, anciennes triées de la plus récente à la plus ancienne", async () => {
    const u = await makeUser(db, "moi");
    const t0 = Date.now() - 100_000;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { gameId } = await createGame(db, u, textParams(2, { name: `p${i}` }), new Date(t0 + i * 1000));
      ids.push(gameId);
    }
    await db.update(game).set({ status: "completed", completedAt: new Date(t0 + 50_000) }).where(eq(game.id, ids[0]));
    await db.update(game).set({ status: "cancelled" }).where(eq(game.id, ids[1]));
    const current = await listMyCurrentGames(db, u);
    expect(current.items.map((g) => g.name)).toEqual(["p2"]);
    const past = await listMyPastGames(db, u);
    expect(past.items.map((g) => g.name)).toEqual(["p0", "p1"]);
    expect(past.items[0]).toMatchObject({ status: "completed", creatorName: "moi", participantCount: 1 });
  });
});
