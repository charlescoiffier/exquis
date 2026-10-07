import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { contribution } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import { getMyTurn, submitDrawing } from "@/lib/services/turns";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, drawingParams, startedGame } from "../helpers/games";
import { solidPng } from "../helpers/images";

const db = testDb();
let storage: MemoryStorage;
beforeEach(async () => {
  await resetDb(db);
  storage = new MemoryStorage();
});

describe("tour de dessin", () => {
  it("le tour 1 n'a pas de bande ; l'image complète n'est jamais exposée au tour 2", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    expect(await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId })).toMatchObject({ rank: 1, stripUrl: undefined });

    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#ff0000") });
    const t2 = await activeTurn(db, gameId);
    const mine = await getMyTurn(db, storage, { userId: t2.assignedUserId, gameId });
    expect(mine?.stripUrl).toBe(`memory://games/${gameId}/turns/1/strip.png`);
    expect(JSON.stringify(mine)).not.toContain("full.png");
    expect(await storage.exists(`games/${gameId}/turns/1/full.png`)).toBe(true);
  });

  it("refuse une image invalide sans rien stocker", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: Buffer.from("pas une image") })).rejects.toMatchObject({ code: "invalid_image" });
    expect(storage.files.size).toBe(0);
    expect(await db.select().from(contribution)).toHaveLength(0);
  });

  it("accepte une bande héritée repeinte, refuse toujours un mauvais format ou de mauvaises dimensions", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    const red = await solidPng("down", "#ff0000");
    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: red });
    const t2 = await activeTurn(db, gameId);

    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(submitDrawing(db, storage, { userId: t2.assignedUserId, gameId, png: small })).rejects.toMatchObject({ code: "invalid_image" });

    const repainted = await solidPng("down", "#00ff00"); // bande héritée entièrement repeinte
    const effects = await submitDrawing(db, storage, { userId: t2.assignedUserId, gameId, png: repainted });
    expect(effects).toContainEqual({ kind: "finalize-game", gameId });
    const [c] = await db.select().from(contribution).where(eq(contribution.turnId, t2.id));
    expect(c.imageKey).toBe(`games/${gameId}/turns/2/full.png`);
  });

  it("refuse une soumission de dessin sur une partie de texte", async () => {
    const { gameId } = await startedGame(db, { ...drawingParams(2), type: "text", direction: undefined, language: "fr", minWords: 1, maxWords: 5, excerptMode: "paragraph" });
    const t1 = await activeTurn(db, gameId);
    await expect(submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#fff") })).rejects.toMatchObject({ code: "wrong_type" });
  });
});
