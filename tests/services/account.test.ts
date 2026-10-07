import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { user } from "@/lib/db/auth-schema";
import { profile } from "@/lib/db/schema";
import { updateProfile } from "@/lib/services/account";
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
