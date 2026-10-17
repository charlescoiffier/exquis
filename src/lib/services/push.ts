import { and, eq, isNull } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { game, notification, pushSubscription } from "@/lib/db/schema";
import { env, pushConfigured } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { describeNotification } from "@/lib/notifications/render";

/** Une notification en attente de plus de 24 h n'a plus d'intérêt : elle est close sans être envoyée. */
export const PUSH_MAX_AGE_MS = 24 * 3600_000;

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = { title: string; body: string; url: string; tag?: string };
/** Envoie un message à un appareil ; lève une erreur portant `statusCode` (404 ou 410 : abonnement périmé). */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

/** Émetteur réel (bibliothèque web-push, clés VAPID de l'environnement). */
export function getPushSender(): PushSender {
  const e = env();
  webpush.setVapidDetails(e.VAPID_SUBJECT ?? e.APP_URL, e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
  return async (target, payload) => {
    await webpush.sendNotification(target, JSON.stringify(payload), { TTL: 24 * 3600 });
  };
}

export const MAX_DEVICES_PER_USER = 10;

/** Enregistre (ou transfère au compte courant) l'abonnement d'un appareil. */
export async function saveSubscription(
  db: Db,
  p: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent?: string },
): Promise<void> {
  if (!/^https:\/\//.test(p.endpoint)) throw new DomainError("invalid_endpoint", "Adresse d'abonnement invalide.", 400);
  const mine = await db.select({ id: pushSubscription.id, endpoint: pushSubscription.endpoint }).from(pushSubscription).where(eq(pushSubscription.userId, p.userId));
  if (!mine.some((m) => m.endpoint === p.endpoint) && mine.length >= MAX_DEVICES_PER_USER) {
    throw new DomainError("too_many_devices", `Vous pouvez activer au plus ${MAX_DEVICES_PER_USER} appareils.`, 429);
  }
  await db
    .insert(pushSubscription)
    .values({ userId: p.userId, endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth, userAgent: p.userAgent?.slice(0, 300) })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { userId: p.userId, p256dh: p.p256dh, auth: p.auth, userAgent: p.userAgent?.slice(0, 300) } });
}

export async function removeSubscription(db: Db, p: { userId: string; endpoint: string }): Promise<void> {
  await db.delete(pushSubscription).where(and(eq(pushSubscription.userId, p.userId), eq(pushSubscription.endpoint, p.endpoint)));
}

export async function countSubscriptions(db: Db, userId: string): Promise<number> {
  return (await db.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.userId, userId))).length;
}

async function deliver(db: Db, sender: PushSender, userId: string, payload: PushPayload): Promise<number> {
  const subs = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Appareil désinscrit ou abonnement expiré : on l'oublie ; toute autre erreur est réessayée au prochain passage.
      if (status === 404 || status === 410) await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
      else console.error("[push] échec d'envoi", status ?? "", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** Envoie les notifications en attente aux appareils de chaque joueur. Renvoie le nombre de messages remis. */
export async function flushPush(db: Db, sender: PushSender, now = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      gameId: notification.gameId,
      createdAt: notification.createdAt,
      gameName: game.name,
      actorName: user.name,
    })
    .from(notification)
    .leftJoin(game, eq(game.id, notification.gameId))
    .leftJoin(user, eq(user.id, notification.actorId))
    .where(and(eq(notification.pushPending, true), isNull(notification.pushedAt)))
    .orderBy(notification.createdAt)
    .limit(100);
  let sent = 0;
  for (const r of rows) {
    if (now.getTime() - r.createdAt.getTime() <= PUSH_MAX_AGE_MS) {
      const d = describeNotification(r);
      sent += await deliver(db, sender, r.userId, { title: "Exquis", body: d.text, url: d.href, tag: r.id });
    }
    await db.update(notification).set({ pushedAt: now }).where(eq(notification.id, r.id));
  }
  return sent;
}

/** Notification de test sur tous les appareils du compte. Renvoie le nombre d'appareils atteints. */
export async function sendTestPush(db: Db, sender: PushSender, userId: string): Promise<number> {
  if (!pushConfigured()) throw new DomainError("push_unavailable", "Les notifications sur téléphone ne sont pas configurées sur ce serveur.", 503);
  return deliver(db, sender, userId, { title: "Exquis", body: "Les notifications fonctionnent sur cet appareil.", url: "/account", tag: "test" });
}
