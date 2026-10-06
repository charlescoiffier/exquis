import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/register/route";
import { invitation } from "@/lib/db/schema";
import { user } from "@/lib/db/auth-schema";
import { createInvitation } from "@/lib/services/invitations";
import { resetDb, testDb } from "../helpers/db";

vi.mock("@/lib/notifications/mailer", () => ({ getMailer: () => ({ send: async () => {} }) }));

const db = testDb();
beforeEach(() => resetDb(db));

const register = (email: string, invitationCode?: string) =>
  POST(
    new Request("http://localhost:3000/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", email, password: "un-mot-de-passe-long", invitationCode }),
    }),
  );
const usedBy = async (code: string) => (await db.select().from(invitation).where(eq(invitation.code, code)))[0].usedBy;

describe("POST /api/register", () => {
  it("consomme l'invitation à la réussite et refuse une seconde utilisation", async () => {
    const code = await createInvitation(db, null);
    const res = await register("a@test.dev", code);
    expect(res.status).toBe(200);
    const [u] = await db.select().from(user).where(eq(user.email, "a@test.dev"));
    expect(await usedBy(code)).toBe(u.id);
    expect((await register("b@test.dev", code)).status).toBe(403);
    expect(await db.select().from(user).where(eq(user.email, "b@test.dev"))).toHaveLength(0);
  });
  it("email déjà pris : invitation réutilisable, réponse indiscernable du succès", async () => {
    const first = await createInvitation(db, null);
    const ok = await register("dup@test.dev", first);
    const code = await createInvitation(db, null);
    const dup = await register("dup@test.dev", code);
    expect(dup.status).toBe(ok.status);
    expect(Object.keys(await dup.json()).sort()).toEqual(Object.keys(await ok.json()).sort());
    expect(await usedBy(code)).toBeNull();
    expect((await register("new@test.dev", code)).status).toBe(200);
  });
  it("code absent ou invalide : 403 et rien n'est créé", async () => {
    expect((await register("x@test.dev")).status).toBe(403);
    expect((await register("x@test.dev", "inconnu")).status).toBe(403);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});
