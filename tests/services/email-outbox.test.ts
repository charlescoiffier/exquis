import { inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/lib/db/auth-schema";
import { notification, profile } from "@/lib/db/schema";
import { flushNotifications } from "@/lib/services/email-outbox";
import { renderEmail } from "@/lib/notifications/render";
import type { Mailer } from "@/lib/notifications/mailer";
import { createGame, joinGame } from "@/lib/services/games";
import { resetDb, testDb, makeUser } from "../helpers/db";
import { startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

class SpyMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  fail = false;
  async send(m: { to: string; subject: string; text: string }) {
    if (this.fail) throw new Error("boom");
    this.sent.push(m);
  }
}

describe("flushNotifications", () => {
  it("envoie les emails en attente une seule fois", async () => {
    await startedGame(db, textParams(2, { turnDurationSeconds: 3600 }));
    const mailer = new SpyMailer();
    const n = await flushNotifications(db, mailer);
    expect(n).toBeGreaterThan(0);
    expect(await flushNotifications(db, mailer)).toBe(0);
  });
  it("n'envoie rien pour les tours courts", async () => {
    await startedGame(db, textParams(2, { turnDurationSeconds: 60 }));
    const mailer = new SpyMailer();
    expect(await flushNotifications(db, mailer)).toBe(0);
    expect(await db.select().from(notification)).not.toHaveLength(0);
  });
  it("respecte la préférence email désactivée", async () => {
    const params = textParams(2);
    const u0 = await makeUser(db, "p0");
    const u1 = await makeUser(db, "p1");
    await db.insert(profile).values({ userId: u0, emailEnabled: false });
    const { gameId } = await createGame(db, u0, params, new Date());
    await joinGame(db, { userId: u1, gameId, now: new Date() });
    const mailer = new SpyMailer();
    expect(await flushNotifications(db, mailer)).toBeGreaterThan(0);
    const rows = await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, [u0, u1]));
    const email = (id: string) => rows.find((r) => r.id === id)!.email;
    const recipients = mailer.sent.map((m) => m.to);
    expect(recipients).not.toContain(email(u0));
    expect(recipients).toContain(email(u1));
  });
  it("réessaie après un échec d'envoi", async () => {
    await startedGame(db, textParams(2));
    const mailer = new SpyMailer();
    mailer.fail = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await flushNotifications(db, mailer)).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    mailer.fail = false;
    expect(await flushNotifications(db, mailer)).toBeGreaterThan(0);
  });
});

describe("renderEmail", () => {
  it("génère un sujet et un lien vers la partie", () => {
    const m = renderEmail("your_turn", { gameName: "Ma partie", appUrl: "http://x", gameId: "g1" });
    expect(m.subject).toContain("Ma partie");
    expect(m.text).toContain("http://x/games/g1");
  });
});
