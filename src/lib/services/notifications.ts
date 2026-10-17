import { and, count, desc, eq, isNull } from "drizzle-orm";
import { user } from "@/lib/db/auth-schema";
import type { Db, Executor } from "@/lib/db/client";
import { game, notification, profile } from "@/lib/db/schema";
import { pushConfigured } from "@/lib/env";

export type NotificationType =
  | "game_started" | "your_turn" | "turn_reminder" | "turn_reassigned"
  | "game_completed" | "game_cancelled" | "work_ready" | "comment_added"
  | "friend_request" | "friend_accepted" | "game_invite" | "comment_hidden" | "work_hidden";

export const EMAIL_MIN_DURATION_SECONDS = 300;

export async function queueNotification(
  tx: Executor,
  n: {
    userId: string;
    type: NotificationType;
    /** Absent pour une notification qui ne concerne pas une partie (demande d'ami). */
    gameId?: string;
    /** Personne à l'origine de la notification. */
    actorId?: string;
    turnId?: string;
    suffix?: string;
    /** Pas d'email (notification dans l'application seulement). */
    inAppOnly?: boolean;
  },
): Promise<void> {
  const [g] = n.gameId ? await tx.select({ d: game.turnDurationSeconds }).from(game).where(eq(game.id, n.gameId)) : [];
  const [p] = await tx.select({ e: profile.emailEnabled, push: profile.notifyPush }).from(profile).where(eq(profile.userId, n.userId));
  const emailPending = !n.inAppOnly && !!n.gameId && (p?.e ?? true) && (g?.d ?? 0) >= EMAIL_MIN_DURATION_SECONDS;
  // Push : tous les types (y compris demandes d'ami et invitations), même pour les tours courts ; seulement si la fonction est configurée.
  const pushPending = (p?.push ?? true) && pushConfigured();
  const dedupeKey = `${n.type}:${n.turnId ?? n.gameId ?? n.actorId}:${n.userId}${n.suffix ? `:${n.suffix}` : ""}`;
  await tx
    .insert(notification)
    .values({ userId: n.userId, type: n.type, gameId: n.gameId, actorId: n.actorId, turnId: n.turnId, dedupeKey, emailPending, pushPending })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

export async function listNotifications(db: Db, userId: string) {
  return db
    .select({
      id: notification.id,
      type: notification.type,
      gameId: notification.gameId,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      gameName: game.name,
      actorName: user.name,
    })
    .from(notification)
    .leftJoin(game, eq(game.id, notification.gameId))
    .leftJoin(user, eq(user.id, notification.actorId))
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt))
    .limit(50);
}

/** Nombre de notifications non lues (pour la pastille de la barre d'onglets). */
export async function countUnread(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return row?.n ?? 0;
}

export async function markAllRead(db: Db, userId: string, now = new Date()) {
  await db.update(notification).set({ readAt: now }).where(and(eq(notification.userId, userId), isNull(notification.readAt)));
}
