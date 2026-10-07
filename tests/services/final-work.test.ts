import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { finalWork, game, notification, turn } from "@/lib/db/schema";
import { finalLength, jointsFor } from "@/lib/images/geometry";
import { extractStrip } from "@/lib/images/strip";
import { assembleFinalWork, getFinal, getFinalImage } from "@/lib/services/final-work";
import { expireTurn, submitDrawing, submitText } from "@/lib/services/turns";
import { MemoryStorage } from "@/lib/storage/memory";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, drawingParams, startedGame, textParams } from "../helpers/games";
import { paste, solidPng } from "../helpers/images";

const db = testDb();
let storage: MemoryStorage;
beforeEach(async () => {
  await resetDb(db);
  storage = new MemoryStorage();
});

async function playDrawing() {
  const g = await startedGame(db, drawingParams(2));
  const t1 = await activeTurn(db, g.gameId);
  const red = await solidPng("down", "#ff0000");
  await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId: g.gameId, png: red });
  const t2 = await activeTurn(db, g.gameId);
  const png2 = await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0);
  await submitDrawing(db, storage, { userId: t2.assignedUserId, gameId: g.gameId, png: png2 });
  return g;
}

describe("assembleFinalWork / getFinal (dessin)", () => {
  it("assemble, stocke les jointures et notifie", async () => {
    const { gameId, users } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    await assembleFinalWork(db, storage, gameId); // idempotent
    const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
    expect(fw).toMatchObject({ width: 1200, height: 3040, joints: [{ start: 1440, end: 1600 }] });
    expect(await db.select().from(notification).where(eq(notification.type, "work_ready"))).toHaveLength(users.length);
    const view = await getFinal(db, { userId: users[0], gameId });
    expect(view).toMatchObject({ type: "drawing", ready: true, direction: "down", width: 1200, height: 3040 });
    expect(view.contributions.map((c) => c.rank)).toEqual([1, 2]);
    expect(view.segments).toEqual([
      { rank: 1, author: view.contributions[0].author, start: 0, end: 1440 },
      { rank: 2, author: view.contributions[1].author, start: 1600, end: 3040 },
    ]);
    expect(view.contributions.every((c) => c.author.length > 0)).toBe(true);
  });
  it("sert l'image propre et la variante avec jointures, différentes l'une de l'autre", async () => {
    const { gameId, users } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    const clean = await getFinalImage(db, storage, { userId: users[0], gameId, guides: false });
    const guided = await getFinalImage(db, storage, { userId: users[0], gameId, guides: true });
    expect((await sharp(clean).metadata()).height).toBe(3040);
    expect(guided.equals(clean)).toBe(false);
    expect(await storage.exists(`games/${gameId}/final/guides.png`)).toBe(true);
  });
  it("refuse l'accès aux non-participants et avant la fin", async () => {
    const { gameId } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    const stranger = await makeUser(db, "stranger");
    await expect(getFinal(db, { userId: stranger, gameId })).rejects.toMatchObject({ code: "forbidden" });
    const running = await startedGame(db, drawingParams(2));
    await expect(getFinal(db, { userId: running.users[0], gameId: running.gameId })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("indique ready=false tant que l'assemblage n'a pas eu lieu", async () => {
    const { gameId, users } = await playDrawing();
    expect((await getFinal(db, { userId: users[0], gameId })).ready).toBe(false);
  });
});

describe("œuvre finale (texte)", () => {
  it("révèle les auteurs et les textes dans l'ordre", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "premier texte" });
    const t2 = await activeTurn(db, gameId);
    await submitText(db, { userId: t2.assignedUserId, gameId, text: "second texte" });
    await assembleFinalWork(db, storage, gameId);
    const view = await getFinal(db, { userId: users[0], gameId });
    expect(view.type).toBe("text");
    expect(view.contributions.map((c) => c.text)).toEqual(["premier texte", "second texte"]);
    expect(view.segments).toEqual([]);
  });
});

/** Fait expirer le tour actif jusqu'à l'annulation de la partie ; renvoie les effets de l'annulation. */
async function cancelGame(gameId: string) {
  for (let i = 0; i < 10; i++) {
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    if (g.status === "cancelled") break;
    const t = await activeTurn(db, gameId);
    const effects = await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000) });
    if (effects.some((e) => e.kind === "finalize-game")) return effects;
  }
  throw new Error("la partie n'a pas été annulée");
}

describe("partie annulée (spec §5.4 : les contributions restent visibles)", () => {
  it("texte : un participant voit les contributions, un étranger est refusé", async () => {
    const { gameId, users } = await startedGame(db, textParams(4));
    const t1 = await activeTurn(db, gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "premier texte" });
    const t2 = await activeTurn(db, gameId);
    await submitText(db, { userId: t2.assignedUserId, gameId, text: "second texte" });
    await cancelGame(gameId);
    const view = await getFinal(db, { userId: users[3], gameId });
    expect(view.cancelled).toBe(true);
    expect(view.contributions.map((c) => c.text)).toEqual(["premier texte", "second texte"]);
    const stranger = await makeUser(db, "stranger");
    await expect(getFinal(db, { userId: stranger, gameId })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("une partie terminée n'est pas marquée annulée", async () => {
    const { gameId, users } = await playDrawing();
    expect((await getFinal(db, { userId: users[0], gameId })).cancelled).toBe(false);
  });

  it("dessin : assemble 1 contribution (hauteur finalLength(1), sans jointure), sans notifier work_ready", async () => {
    const { gameId, users } = await startedGame(db, drawingParams(4));
    const t1 = await activeTurn(db, gameId);
    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#ff0000") });
    await cancelGame(gameId);
    await assembleFinalWork(db, storage, gameId);
    await assembleFinalWork(db, storage, gameId); // idempotent
    const rows = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ width: 1200, height: finalLength(1), joints: [] });
    expect(await db.select().from(notification).where(eq(notification.type, "work_ready"))).toHaveLength(0);
    const view = await getFinal(db, { userId: users[2], gameId });
    expect(view).toMatchObject({ cancelled: true, ready: true });
    expect(view.contributions.map((c) => c.rank)).toEqual([1]);
    expect(view.segments).toEqual([{ rank: 1, author: view.contributions[0].author, start: 0, end: 1600 }]);
    const img = await getFinalImage(db, storage, { userId: users[2], gameId, guides: false });
    expect((await sharp(img).metadata()).height).toBe(finalLength(1));
  });

  it("dessin : assemble 2 contributions (hauteur finalLength(2), 1 jointure)", async () => {
    const { gameId, users } = await startedGame(db, drawingParams(4));
    const t1 = await activeTurn(db, gameId);
    const red = await solidPng("down", "#ff0000");
    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: red });
    const t2 = await activeTurn(db, gameId);
    const png2 = await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0);
    await submitDrawing(db, storage, { userId: t2.assignedUserId, gameId, png: png2 });
    await cancelGame(gameId);
    await assembleFinalWork(db, storage, gameId);
    const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
    expect(fw).toMatchObject({ width: 1200, height: finalLength(2), joints: jointsFor(2) });
    expect(jointsFor(2)).toHaveLength(1);
    const img = await getFinalImage(db, storage, { userId: users[0], gameId, guides: false });
    expect((await sharp(img).metadata()).height).toBe(finalLength(2));
    expect(await db.select().from(notification).where(eq(notification.type, "work_ready"))).toHaveLength(0);
  });

  it("dessin sans aucune contribution : ligne sans image", async () => {
    const { gameId, users } = await startedGame(db, drawingParams(4));
    await cancelGame(gameId);
    await assembleFinalWork(db, storage, gameId);
    const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
    expect(fw.imageKey).toBeNull();
    const view = await getFinal(db, { userId: users[0], gameId });
    expect(view).toMatchObject({ cancelled: true, ready: true, contributions: [] });
    await expect(getFinalImage(db, storage, { userId: users[0], gameId, guides: false })).rejects.toMatchObject({ code: "not_ready" });
  });

  it("les tours d'une partie annulée avec contribution sont done, le tour expiré n'en a pas", async () => {
    const { gameId } = await startedGame(db, drawingParams(4));
    const t1 = await activeTurn(db, gameId);
    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#ff0000") });
    await cancelGame(gameId);
    const turns = await db.select().from(turn).where(eq(turn.gameId, gameId));
    expect(turns.find((t) => t.rank === 1)!.status).toBe("done");
    expect(turns.filter((t) => t.status === "expired")).toHaveLength(1);
  });
});
