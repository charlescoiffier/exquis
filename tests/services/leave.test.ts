import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { game, participant, turn } from "@/lib/db/schema";
import { claimOpenCall, createGame, getGameView, joinGame, leaveGame, listMyCurrentGames } from "@/lib/services/games";
import { submitText } from "@/lib/services/turns";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

describe("leaveGame", () => {
  it("partie en attente : se désinscrire libère la place, la partie est annulée si plus personne", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const { gameId } = await createGame(db, a, textParams(3));
    await joinGame(db, { userId: b, gameId });
    await leaveGame(db, { userId: b, gameId });
    expect((await getGameView(db, { gameId, userId: a })).participantCount).toBe(1);
    await leaveGame(db, { userId: a, gameId });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("cancelled");
  });

  it("partie en cours : le tour actif devient un appel à participation, repris par un volontaire", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t = await activeTurn(db, gameId);
    await leaveGame(db, { userId: t.assignedUserId, gameId });
    const [open] = await db.select().from(turn).where(and(eq(turn.gameId, gameId), eq(turn.status, "open_call")));
    expect(open).toMatchObject({ rank: t.rank, assignedUserId: null, deadline: null });
    expect((await listMyCurrentGames(db, t.assignedUserId)).total).toBe(0);
    expect((await getGameView(db, { gameId, userId: t.assignedUserId })).isParticipant).toBe(false);
    await expect(claimOpenCall(db, { userId: t.assignedUserId, gameId })).rejects.toMatchObject({ code: "already_left" });
    const volunteer = await makeUser(db, "volontaire");
    await claimOpenCall(db, { userId: volunteer, gameId });
    expect((await activeTurn(db, gameId)).assignedUserId).toBe(volunteer);
  });

  it("partie en cours : un tour à venir libéré devient un appel à participation une fois atteint", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const first = await activeTurn(db, gameId);
    const other = users.find((u) => u !== first.assignedUserId)!;
    await leaveGame(db, { userId: other, gameId });
    await submitText(db, { userId: first.assignedUserId, gameId, text: "un deux" });
    const [second] = await db.select().from(turn).where(and(eq(turn.gameId, gameId), eq(turn.rank, 2)));
    expect(second).toMatchObject({ status: "open_call", assignedUserId: null });
    const [row] = await db.select().from(participant).where(and(eq(participant.gameId, gameId), eq(participant.userId, other)));
    expect(row.leftAt).not.toBeNull();
  });

  it("partie en cours : sans joueur restant, la partie est annulée ; une partie terminée ne se quitte pas", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    for (const u of users) await leaveGame(db, { userId: u, gameId });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("cancelled");
    await expect(leaveGame(db, { userId: users[0], gameId })).rejects.toMatchObject({ code: "not_participant" });
  });
});
