import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { notification } from "@/lib/db/schema";
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
  it("handleSweep expire les tours en retard", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    expect((await handleSweep(deps(late))).length).toBeGreaterThan(0);
    expect((await activeTurn(db, gameId)).attempts).toBe(1);
  });
});
