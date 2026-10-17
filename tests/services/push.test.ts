import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { notification, pushSubscription } from "@/lib/db/schema";
import { updateProfile } from "@/lib/services/account";
import { PUSH_MAX_AGE_MS, MAX_DEVICES_PER_USER, countSubscriptions, deviceLabel, flushPush, removeSubscription, saveSubscription, sendTestPush, type PushSender } from "@/lib/services/push";
import { queueNotification } from "@/lib/services/notifications";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { startedGame, textParams } from "../helpers/games";

// Avant le premier appel à env() : les notifications sur téléphone sont disponibles.
process.env.VAPID_PUBLIC_KEY = "cle-publique-de-test";
process.env.VAPID_PRIVATE_KEY = "cle-privee-de-test";

const db = testDb();
beforeEach(() => resetDb(db));

const sub = (n: number) => ({ endpoint: `https://push.example.com/${n}`, p256dh: `p${n}`, auth: `a${n}` });

function recorder(failWith?: Record<string, number>) {
  const sent: { endpoint: string; body: string; url: string }[] = [];
  const sender: PushSender = async (t, payload) => {
    const status = failWith?.[t.endpoint];
    if (status) throw Object.assign(new Error("échec"), { statusCode: status });
    sent.push({ endpoint: t.endpoint, body: payload.body, url: payload.url });
  };
  return { sent, sender };
}

describe("abonnements", () => {
  it("enregistre, met à jour, transfère au dernier compte connecté, supprime ; adresse https exigée ; nombre d'appareils borné", async () => {
    const [a, b] = [await makeUser(db, "a"), await makeUser(db, "b")];
    await saveSubscription(db, { userId: a, ...sub(1), userAgent: "Android" });
    await saveSubscription(db, { userId: a, ...sub(1), p256dh: "nouvelle" });
    expect(await countSubscriptions(db, a)).toBe(1);
    await saveSubscription(db, { userId: b, ...sub(1) });
    expect([await countSubscriptions(db, a), await countSubscriptions(db, b)]).toEqual([0, 1]);
    await expect(saveSubscription(db, { userId: a, ...sub(2), endpoint: "http://non-securise" })).rejects.toMatchObject({ code: "invalid_endpoint" });
    for (let i = 10; i < 10 + MAX_DEVICES_PER_USER; i++) await saveSubscription(db, { userId: a, ...sub(i) });
    await expect(saveSubscription(db, { userId: a, ...sub(99) })).rejects.toMatchObject({ code: "too_many_devices" });
    await removeSubscription(db, { userId: b, endpoint: sub(1).endpoint });
    expect(await countSubscriptions(db, b)).toBe(0);
  });
});

describe("envoi des notifications", () => {
  async function notifyAbout(userId: string, gameId: string, type: "your_turn" | "game_started" = "your_turn", suffix?: string) {
    await db.transaction((tx) => queueNotification(tx, { userId, type, gameId, suffix }));
  }

  it("envoie à tous les appareils du joueur, une seule fois, avec le texte et le lien de la notification", async () => {
    const { gameId, users } = await startedGame(db, textParams(2, { name: "Ma partie" }));
    const [u] = users;
    await db.delete(notification);
    await saveSubscription(db, { userId: u, ...sub(1) });
    await saveSubscription(db, { userId: u, ...sub(2) });
    await notifyAbout(u, gameId);
    const { sent, sender } = recorder();
    expect(await flushPush(db, sender)).toBe(2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
    expect(sent[0]).toMatchObject({ body: "C'est votre tour — Ma partie", url: `/games/${gameId}` });
    expect(await flushPush(db, sender)).toBe(0);
  });

  it("n'envoie rien si le joueur a choisi « email seulement » ou « aucune » ; clôt sans envoyer au-delà de 24 h", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const [u, v] = users;
    await db.delete(notification);
    await saveSubscription(db, { userId: u, ...sub(1) });
    await saveSubscription(db, { userId: v, ...sub(2) });
    await updateProfile(db, u, { notifyMode: "email" });
    await updateProfile(db, v, { notifyMode: "both" });
    await notifyAbout(u, gameId);
    await notifyAbout(v, gameId);
    const { sent, sender } = recorder();
    await flushPush(db, sender);
    expect(sent.map((s) => s.endpoint)).toEqual([sub(2).endpoint]);
    // Ancienne notification : close sans envoi.
    await notifyAbout(v, gameId, "game_started");
    const late = new Date(Date.now() + PUSH_MAX_AGE_MS + 60_000);
    expect(await flushPush(db, sender, late)).toBe(0);
    expect((await db.select().from(notification).where(eq(notification.pushPending, true))).every((n) => n.pushedAt !== null)).toBe(true);
  });

  it("un appareil désinscrit (404 ou 410) est oublié ; une autre erreur le conserve", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const [u] = users;
    await db.delete(notification);
    await saveSubscription(db, { userId: u, ...sub(1) });
    await saveSubscription(db, { userId: u, ...sub(2) });
    await saveSubscription(db, { userId: u, ...sub(3) });
    await notifyAbout(u, gameId);
    const { sent, sender } = recorder({ [sub(1).endpoint]: 410, [sub(2).endpoint]: 500 });
    expect(await flushPush(db, sender)).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual([sub(3).endpoint]);
    expect((await db.select().from(pushSubscription).where(eq(pushSubscription.userId, u))).map((s) => s.endpoint).sort()).toEqual([sub(2).endpoint, sub(3).endpoint]);
  });

  it("les notifications sans partie (demande d'ami) partent aussi ; test d'envoi sur tous les appareils", async () => {
    const [a, b] = [await makeUser(db, "a"), await makeUser(db, "b")];
    await saveSubscription(db, { userId: b, ...sub(1) });
    await db.transaction((tx) => queueNotification(tx, { userId: b, type: "friend_request", actorId: a, inAppOnly: true }));
    const { sent, sender } = recorder();
    expect(await flushPush(db, sender)).toBe(1);
    expect(sent[0]).toMatchObject({ body: "a vous a envoyé une demande d'ami", url: "/friends" });
    expect(await sendTestPush(db, sender, b)).toEqual([{ device: "Navigateur", ok: true }]);
    expect(await sendTestPush(db, sender, a)).toEqual([]);
  });
});

describe("test d'envoi", () => {
  it("donne le résultat de chaque appareil, avec le code d'erreur du service de notification, et nomme les appareils", async () => {
    const u = await makeUser(db, "a");
    await saveSubscription(db, { userId: u, ...sub(1), userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36" });
    await saveSubscription(db, { userId: u, ...sub(2), userAgent: "Mozilla/5.0 (Linux; Android 10; K) Chrome/154.0 Mobile Safari/537.36" });
    await saveSubscription(db, { userId: u, ...sub(3), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1" });
    const { sender } = recorder({ [sub(2).endpoint]: 403, [sub(3).endpoint]: 410 });
    const results = await sendTestPush(db, sender, u);
    expect(results).toMatchObject([
      { device: "Chrome sur Mac", ok: true },
      { device: "Chrome sur Android", ok: false, status: 403 },
      { device: "Safari sur iPhone", ok: false, status: 410 },
    ]);
    expect(await countSubscriptions(db, u)).toBe(2); // l'abonnement périmé (410) est oublié
    expect(deviceLabel(null)).toBe("Navigateur");
  });
});
