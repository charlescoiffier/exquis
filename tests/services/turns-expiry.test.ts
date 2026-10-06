import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { game, notification, participant, turn } from "@/lib/db/schema";
import { claimOpenCall, getGameView, listOpenCalls } from "@/lib/services/games";
import { expireOverdue, expireTurn, getMyTurn, submitText } from "@/lib/services/turns";
import { MemoryStorage } from "@/lib/storage/memory";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));
const after = (d: Date) => new Date(d.getTime() + SUBMIT_GRACE_MS + 1000);

describe("expireTurn", () => {
  it("ne fait rien avant la fin de la tolérance", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    expect(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: t.deadline! })).toEqual([]);
    expect((await activeTurn(db, gameId)).attempts).toBe(0);
  });

  it("remet le tour en jeu : échange avec le prochain joueur", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const next = (await db.select().from(turn).where(eq(turn.gameId, gameId))).find((x) => x.rank === 2)!;
    const effects = await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    expect(effects.map((e) => e.kind)).toEqual(expect.arrayContaining(["schedule-turn", "flush-notifications"]));
    const t2 = await activeTurn(db, gameId);
    expect(t2.id).toBe(t.id);
    expect(t2.assignedUserId).toBe(next.assignedUserId);
    expect(t2.attempts).toBe(1);
    expect(t2.deadline!.getTime()).toBeGreaterThan(t.deadline!.getTime());
    const [swapped] = await db.select().from(turn).where(eq(turn.id, next.id));
    expect(swapped.assignedUserId).toBe(t.assignedUserId);
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reassigned"))).toHaveLength(1);
  });

  it("annule la partie après 2 remises en jeu", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    for (let i = 0; i < 3; i++) {
      const t = await activeTurn(db, gameId);
      if (!t) break;
      await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    }
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("cancelled");
    expect(await db.select().from(notification).where(eq(notification.type, "game_cancelled"))).toHaveLength(3);
  });

  // Cas du dernier tour : voir aussi expireOverdue plus bas.
  async function lastTurnExpired() {
    const g = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, g.gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId: g.gameId, text: "un deux" });
    const t2 = await activeTurn(db, g.gameId);
    const effects = await expireTurn(db, { turnId: t2.id, deadline: t2.deadline!, now: after(t2.deadline!) });
    return { ...g, t2, effects };
  }

  it("lance un appel à participation quand le dernier tour expire (la partie n'est pas annulée)", async () => {
    const { gameId, t2, effects } = await lastTurnExpired();
    expect(effects).toEqual([{ kind: "flush-notifications" }]);
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("in_progress");
    const [t] = await db.select().from(turn).where(eq(turn.id, t2.id));
    expect(t).toMatchObject({ status: "open_call", assignedUserId: null, deadline: null });
    expect(await listOpenCalls(db)).toMatchObject([{ id: gameId, rank: 2, turns: 2 }]);
    expect(await getMyTurn(db, new MemoryStorage(), { userId: t2.assignedUserId, gameId })).toBeNull();
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reassigned"))).toHaveLength(1);
    const view = await getGameView(db, { gameId, userId: t2.assignedUserId });
    expect(view.openCall).toBe(true);
  });

  it("un volontaire reprend le tour et peut terminer la partie", async () => {
    const { gameId } = await lastTurnExpired();
    const volunteer = await makeUser(db, "volontaire");
    const { effects } = await claimOpenCall(db, { userId: volunteer, gameId });
    expect(effects.map((e) => e.kind)).toEqual(["schedule-turn", "flush-notifications"]);
    expect(await listOpenCalls(db)).toEqual([]);
    expect(await db.select().from(participant).where(eq(participant.gameId, gameId))).toHaveLength(3);
    const t = await activeTurn(db, gameId);
    expect(t.assignedUserId).toBe(volunteer);
    await submitText(db, { userId: volunteer, gameId, text: "trois quatre" });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("completed");
  });

  it("deux volontaires simultanés : un seul réussit", async () => {
    const { gameId } = await lastTurnExpired();
    const a = await makeUser(db, "va");
    const b = await makeUser(db, "vb");
    const results = await Promise.allSettled([claimOpenCall(db, { userId: a, gameId }), claimOpenCall(db, { userId: b, gameId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "open_call_unavailable" });
  });

  it("un participant existant ne peut pas reprendre l'appel", async () => {
    const { gameId, users } = await lastTurnExpired();
    await expect(claimOpenCall(db, { userId: users[0], gameId })).rejects.toMatchObject({ code: "already_joined" });
  });

  it("refuse la reprise quand aucun appel n'est ouvert", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const x = await makeUser(db, "x");
    await expect(claimOpenCall(db, { userId: x, gameId })).rejects.toMatchObject({ code: "open_call_unavailable" });
  });

  it("le balayage ignore un appel non repris, et un volontaire qui laisse expirer relance l'appel", async () => {
    const { gameId } = await lastTurnExpired();
    expect(await expireOverdue(db, new Date(Date.now() + 10 * 86400_000))).toEqual([]);
    const volunteer = await makeUser(db, "volontaire");
    await claimOpenCall(db, { userId: volunteer, gameId });
    const t = await activeTurn(db, gameId);
    await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    const [again] = await db.select().from(turn).where(eq(turn.id, t.id));
    expect(again.status).toBe("open_call");
    expect(again.attempts).toBeGreaterThanOrEqual(2);
    expect(await listOpenCalls(db)).toHaveLength(1);
  });

  it("est sans effet sur un tour déjà soumis ou avec une échéance périmée", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    expect(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) })).toEqual([]);
    const t2 = await activeTurn(db, gameId);
    expect(await expireTurn(db, { turnId: t2.id, deadline: new Date(0), now: after(t2.deadline!) })).toEqual([]);
  });
});

describe("expireOverdue", () => {
  it("expire les tours dépassés, ignore les autres", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    expect(await expireOverdue(db, t.startedAt!)).toEqual([]);
    const effects = await expireOverdue(db, after(t.deadline!));
    expect(effects.length).toBeGreaterThan(0);
    expect((await activeTurn(db, gameId)).attempts).toBe(1);
  });
});
