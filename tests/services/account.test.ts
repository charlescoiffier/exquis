import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { user } from "@/lib/db/auth-schema";
import { profile } from "@/lib/db/schema";
import { getProfile, getProfileStats, updateProfile } from "@/lib/services/account";
import { defaultAvatar } from "@/lib/avatar";
import { addComment } from "@/lib/services/comments";
import { submitText } from "@/lib/services/turns";
import { activeTurn, startedGame, textParams } from "../helpers/games";
import { makeUser, resetDb, testDb } from "../helpers/db";

const db = testDb();
beforeEach(() => resetDb(db));

describe("updateProfile", () => {
  it("change le nom (rogné)", async () => {
    const id = await makeUser(db, "ancien");
    await updateProfile(db, id, { name: "  Nouveau  " });
    expect((await db.select().from(user).where(eq(user.id, id)))[0].name).toBe("Nouveau");
  });
  it("enregistre la préférence d'email, créée au besoin puis modifiée", async () => {
    const id = await makeUser(db, "a");
    await updateProfile(db, id, { emailEnabled: false });
    expect((await db.select().from(profile).where(eq(profile.userId, id)))[0].emailEnabled).toBe(false);
    await updateProfile(db, id, { emailEnabled: true });
    expect((await db.select().from(profile).where(eq(profile.userId, id)))[0].emailEnabled).toBe(true);
  });
  it("refuse un nom vide ou trop long, et une demande vide", async () => {
    const id = await makeUser(db, "a");
    await expect(updateProfile(db, id, { name: "   " })).rejects.toMatchObject({ code: "invalid_name" });
    await expect(updateProfile(db, id, { name: "x".repeat(61) })).rejects.toMatchObject({ code: "invalid_name" });
    await expect(updateProfile(db, id, {})).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("rappel et avatar", () => {
  it("valeurs par défaut : rappel à 25 %, avatar dérivé du compte", async () => {
    const id = await makeUser(db, "a");
    expect(await getProfile(db, id)).toEqual({ emailEnabled: true, reminderStage: 25, avatar: defaultAvatar(id) });
  });
  it("enregistre le moment du rappel (0, 10, 25 ou 50) et refuse les autres", async () => {
    const id = await makeUser(db, "a");
    for (const stage of [50, 10, 0]) {
      await updateProfile(db, id, { reminderStage: stage });
      expect((await getProfile(db, id)).reminderStage).toBe(stage);
    }
    await expect(updateProfile(db, id, { reminderStage: 33 })).rejects.toMatchObject({ code: "invalid_reminder" });
  });
  it("enregistre l'avatar choisi ; refuse forme inconnue, couleur inconnue ou fond identique à la forme", async () => {
    const id = await makeUser(db, "a");
    await updateProfile(db, id, { avatar: { shape: "star", color: "mustard", bg: "teal" } });
    expect((await getProfile(db, id)).avatar).toEqual({ shape: "star", color: "mustard", bg: "teal" });
    for (const avatar of [{ shape: "dragon", color: "mustard", bg: "teal" }, { shape: "star", color: "pink", bg: "teal" }, { shape: "star", color: "teal", bg: "teal" }]) {
      await expect(updateProfile(db, id, { avatar })).rejects.toMatchObject({ code: "invalid_avatar" });
    }
    // Les autres préférences ne touchent pas à l'avatar.
    await updateProfile(db, id, { emailEnabled: false });
    expect((await getProfile(db, id)).avatar.shape).toBe("star");
  });
});

describe("statistiques", () => {
  it("compte parties, tours joués par type et commentaires", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const [a, b] = users;
    expect(await getProfileStats(db, a)).toMatchObject({ gamesJoined: 1, gamesInProgress: 1, gamesCompleted: 0, gamesCreated: 1, turnsPlayed: 0 });
    for (let i = 0; i < 2; i++) {
      const t = await activeTurn(db, gameId);
      await submitText(db, { userId: t.assignedUserId, gameId, text: `tour ${i} du texte` });
    }
    await addComment(db, { userId: b, gameId, body: "bravo" });
    expect(await getProfileStats(db, a)).toMatchObject({ gamesJoined: 1, gamesCompleted: 1, gamesInProgress: 0, turnsPlayed: 1, texts: 1, drawings: 0, commentsWritten: 0 });
    expect(await getProfileStats(db, b)).toMatchObject({ gamesCreated: 0, turnsPlayed: 1, texts: 1, commentsWritten: 1 });
  });
});
