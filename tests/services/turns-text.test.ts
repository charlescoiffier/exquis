import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { contribution, draft, game, notification } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import { getMyTurn, saveDraft, submitText } from "@/lib/services/turns";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
const storage = new MemoryStorage();
beforeEach(() => resetDb(db));

describe("tour de texte", () => {
  it("le tour 1 n'a pas d'extrait ; le tour 2 ne voit que le dernier paragraphe", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t1 = await activeTurn(db, gameId);
    const mine1 = await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId });
    expect(mine1).toMatchObject({ rank: 1, total: 3, excerpt: undefined });

    await submitText(db, { userId: t1.assignedUserId, gameId, text: "Début secret.\n\nFin visible ici." });
    const t2 = await activeTurn(db, gameId);
    expect(t2.rank).toBe(2);
    const mine2 = await getMyTurn(db, storage, { userId: t2.assignedUserId, gameId });
    expect(mine2?.excerpt).toBe("Fin visible ici.");
    expect(JSON.stringify(mine2)).not.toContain("Début secret");
  });

  it("refuse un joueur qui n'est pas assigné", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    const other = users.find((u) => u !== t1.assignedUserId)!;
    expect(await getMyTurn(db, storage, { userId: other, gameId })).toBeNull();
    await expect(submitText(db, { userId: other, gameId, text: "un deux trois" })).rejects.toMatchObject({ code: "not_your_turn" });
  });

  it.each([
    ["trop court", "un"],
    ["vide", "   "],
    ["trop long", Array(60).fill("mot").join(" ")],
  ])("refuse un texte %s", async (_l, text) => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text })).rejects.toMatchObject({ code: "invalid_text" });
  });

  it("compte correctement accents et emoji", async () => {
    const { gameId } = await startedGame(db, textParams(2, { minWords: 4, maxWords: 4 }));
    const t1 = await activeTurn(db, gameId);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "été à Noël 🎄" })).resolves.toBeDefined();
  });

  it("double soumission simultanée : une seule contribution", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t1 = await activeTurn(db, gameId);
    const results = await Promise.allSettled([
      submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux trois" }),
      submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux trois" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "not_your_turn" });
    expect(await db.select().from(contribution)).toHaveLength(1);
  });

  it("accepte dans la tolérance, refuse au-delà", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    const inGrace = new Date(t1.deadline!.getTime() + SUBMIT_GRACE_MS - 1);
    const late = new Date(t1.deadline!.getTime() + SUBMIT_GRACE_MS + 1);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux", now: late })).rejects.toMatchObject({ code: "not_your_turn" });
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux", now: inGrace })).resolves.toBeDefined();
  });

  it("le dernier tour termine la partie et demande l'assemblage", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux" });
    const t2 = await activeTurn(db, gameId);
    const effects = await submitText(db, { userId: t2.assignedUserId, gameId, text: "trois quatre" });
    expect(effects).toEqual(expect.arrayContaining([{ kind: "finalize-game", gameId }, { kind: "flush-notifications" }]));
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("completed");
    expect(await activeTurn(db, gameId)).toBeUndefined();
    const done = await db.select().from(notification).where(eq(notification.type, "game_completed"));
    expect(done).toHaveLength(2);
  });
});

describe("brouillon", () => {
  it("est enregistré puis supprimé à la soumission", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "en cours" } });
    await saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "en cours 2" } });
    expect((await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId }))?.draft).toEqual({ text: "en cours 2" });
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux" });
    expect(await db.select().from(draft)).toHaveLength(0);
  });
  it("refuse un brouillon démesuré", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "x".repeat(3_000_000) } })).rejects.toMatchObject({ code: "draft_too_large" });
  });
  it("refuse un brouillon invalide (undefined)", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(saveDraft(db, { userId: t1.assignedUserId, gameId, content: undefined })).rejects.toMatchObject({ code: "invalid_draft" });
  });
});
