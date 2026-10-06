import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { inviteContext } from "@/lib/invite-context";
import { profile } from "@/lib/db/schema";
import { user } from "@/lib/db/auth-schema";
import { resetDb, testDb } from "../helpers/db";

vi.mock("@/lib/notifications/mailer", () => ({ getMailer: () => ({ send: async () => {} }) }));

const db = testDb();
beforeEach(() => resetDb(db));

const signUp = (email: string) =>
  new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Test", email, password: "un-mot-de-passe-long" }),
  });

describe("verrou d'inscription", () => {
  it("refuse (403) une inscription directe hors invitation", async () => {
    const res = await auth.handler(signUp("direct@test.dev"));
    expect(res.status).toBe(403);
    expect(await db.select().from(user).where(eq(user.email, "direct@test.dev"))).toHaveLength(0);
  });
  it("accepte une inscription dans inviteContext et crée le profil", async () => {
    const res = await inviteContext.run({ code: "x" }, () => auth.handler(signUp("invite@test.dev")));
    expect(res.status).toBe(200);
    const [u] = await db.select().from(user).where(eq(user.email, "invite@test.dev"));
    expect(u).toBeDefined();
    expect(await db.select().from(profile).where(eq(profile.userId, u.id))).toHaveLength(1);
  });
});
