import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db, Executor } from "@/lib/db/client";
import { game, notification, profile } from "@/lib/db/schema";

export type NotificationType =
  | "game_started" | "your_turn" | "turn_reminder" | "turn_reassigned"
  | "game_completed" | "game_cancelled" | "work_ready" | "comment_added";

export const EMAIL_MIN_DURATION_SECONDS = 300;

export async function queueNotification(
  tx: Executor,
  n: { userId: string; type: NotificationType; gameId: string; turnId?: string; suffix?: string; /** Pas d'email (notification dans l'application seulement). */ inAppOnly?: boolean },
): Promise<void> {
  const [g] = await tx.select({ d: game.turnDurationSeconds }).from(game).where(eq(game.id, n.gameId));
  const [p] = await tx.select({ e: profile.emailEnabled }).from(profile).where(eq(profile.userId, n.userId));
  const emailPending = !n.inAppOnly && (p?.e ?? true) && (g?.d ?? 0) >= EMAIL_MIN_DURATION_SECONDS;
  const dedupeKey = `${n.type}:${n.turnId ?? n.gameId}:${n.userId}${n.suffix ? `:${n.suffix}` : ""}`;
  await tx
    .insert(notification)
    .values({ userId: n.userId, type: n.type, gameId: n.gameId, turnId: n.turnId, dedupeKey, emailPending })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

export async function listNotifications(db: Db, userId: string) {
  return db
    .select({ id: notification.id, type: notification.type, gameId: notification.gameId, readAt: notification.readAt, createdAt: notification.createdAt, gameName: game.name })
    .from(notification)
    .innerJoin(game, eq(game.id, notification.gameId))
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
