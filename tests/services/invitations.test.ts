import { beforeEach, describe, expect, it } from "vitest";
import { claimInvitation, createInvitation, MAX_OPEN_INVITATIONS, markInvitationUsed, releaseInvitation } from "@/lib/services/invitations";
import { makeUser, resetDb, testDb } from "../helpers/db";

const db = testDb();
beforeEach(() => resetDb(db));

describe("invitations", () => {
  it("un code ne peut être réclamé qu'une fois", async () => {
    const code = await createInvitation(db, null);
    expect(await claimInvitation(db, code)).toBe(true);
    expect(await claimInvitation(db, code)).toBe(false);
  });
  it("deux réclamations simultanées : une seule gagne", async () => {
    const code = await createInvitation(db, null);
    const results = await Promise.all([claimInvitation(db, code), claimInvitation(db, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("un code libéré peut être réclamé à nouveau", async () => {
    const code = await createInvitation(db, null);
    await claimInvitation(db, code);
    await releaseInvitation(db, code);
    expect(await claimInvitation(db, code)).toBe(true);
  });
  it("refuse un code expiré ou inconnu", async () => {
    const code = await createInvitation(db, null, new Date(Date.now() - 8 * 86400_000));
    expect(await claimInvitation(db, code)).toBe(false);
    expect(await claimInvitation(db, "inconnu")).toBe(false);
  });
  it("limite les invitations ouvertes par utilisateur", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_OPEN_INVITATIONS; i++) await createInvitation(db, u);
    await expect(createInvitation(db, u)).rejects.toMatchObject({ code: "invitation_limit" });
  });
  it("marque l'utilisation", async () => {
    const u = await makeUser(db, "a");
    const code = await createInvitation(db, null);
    await claimInvitation(db, code);
    await markInvitationUsed(db, code, u);
    expect(await claimInvitation(db, code)).toBe(false);
  });
});
