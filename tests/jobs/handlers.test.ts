import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { notification } from "@/lib/db/schema";
import { updateProfile } from "@/lib/services/account";
import { handleExpire, handleRemind, handleSweep, type Deps } from "@/lib/jobs/handlers";
import { reminderTime } from "@/lib/jobs/queue";
import { ConsoleMailer } from "@/lib/notifications/mailer";
import { MemoryStorage } from "@/lib/storage/memory";
import { submitText } from "@/lib/services/turns";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
const deps = (now?: Date): Deps => ({ db, storage: new MemoryStorage(), mailer: new ConsoleMailer(), now: now ? () => now : undefined });
beforeEach(() => resetDb(db));

describe("reminderTime", () => {
  it("à 75 % du temps pour les tours ≥ 120 s", () => {
    const deadline = new Date("2026-01-01T01:00:00Z");
    expect(reminderTime(deadline, 3600)).toEqual(new Date("2026-01-01T00:45:00Z"));
  });
  it("aucun rappel pour les tours courts", () => {
    expect(reminderTime(new Date(), 119)).toBeNull();
  });
  it("selon l'étape choisie : moitié, quart ou dixième du temps restant", () => {
    const deadline = new Date("2026-01-01T01:00:00Z");
    expect(reminderTime(deadline, 3600, 50)).toEqual(new Date("2026-01-01T00:30:00Z"));
    expect(reminderTime(deadline, 3600, 10)).toEqual(new Date("2026-01-01T00:54:00Z"));
  });
});

describe("handlers", () => {
  it("handleExpire est sans effet si le tour a été soumis entre-temps", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    expect(await handleExpire(deps(late), { turnId: t.id, deadline: t.deadline!.toISOString() })).toEqual([]);
  });
  it("handleExpire remet le tour en jeu après l'échéance", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    const effects = await handleExpire(deps(late), { turnId: t.id, deadline: t.deadline!.toISOString() });
    expect(effects.length).toBeGreaterThan(0);
  });
  it("handleRemind notifie une seule fois, et seulement si le tour est encore actif", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const data = { turnId: t.id, deadline: t.deadline!.toISOString() };
    await handleRemind(deps(), data);
    await handleRemind(deps(), data);
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reminder"))).toHaveLength(1);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    const t2 = await activeTurn(db, gameId);
    expect(await handleRemind(deps(), { turnId: t.id, deadline: t.deadline!.toISOString() })).toEqual([]);
    expect(t2.rank).toBe(2);
  });
  it("handleRemind respecte la préférence du joueur : seule l'étape choisie envoie un rappel, 0 n'en envoie aucun", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const data = { turnId: t.id, deadline: t.deadline!.toISOString() };
    const count = async () => (await db.select().from(notification).where(eq(notification.type, "turn_reminder"))).length;
    // Préférence par défaut (25 %) : les étapes 50 et 10 ne font rien.
    expect(await handleRemind(deps(), { ...data, stage: 50 })).toEqual([]);
    expect(await handleRemind(deps(), { ...data, stage: 10 })).toEqual([]);
    expect(await count()).toBe(0);
    await updateProfile(db, t.assignedUserId, { reminderStage: 50 });
    await handleRemind(deps(), { ...data, stage: 25 });
    expect(await count()).toBe(0);
    await handleRemind(deps(), { ...data, stage: 50 });
    expect(await count()).toBe(1);
    await updateProfile(db, t.assignedUserId, { reminderStage: 0 });
    await handleRemind(deps(), { ...data, stage: 10 });
    expect(await count()).toBe(1);
  });
  it("handleSweep expire les tours en retard", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    expect((await handleSweep(deps(late))).length).toBeGreaterThan(0);
    expect((await activeTurn(db, gameId)).attempts).toBe(1);
  });
});
