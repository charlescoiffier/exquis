import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { finalWork, notification } from "@/lib/db/schema";
import { extractStrip } from "@/lib/images/strip";
import { assembleFinalWork, getFinal, getFinalImage } from "@/lib/services/final-work";
import { submitDrawing, submitText } from "@/lib/services/turns";
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
  });
});
