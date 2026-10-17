import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { game, notification } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { Mailer } from "@/lib/notifications/mailer";
import { renderEmail } from "@/lib/notifications/render";
import type { NotificationType } from "./notifications";

/** Âge au-delà duquel une notification en attente d'envoi par email est abandonnée. */
export const EMAIL_MAX_AGE_MS = 24 * 3600_000;

export async function flushNotifications(db: Db, mailer: Mailer, now = new Date()): Promise<number> {
  const rows = await db
    .select({ id: notification.id, type: notification.type, gameId: notification.gameId, createdAt: notification.createdAt, email: user.email, gameName: game.name })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .innerJoin(game, eq(game.id, notification.gameId))
    .where(and(eq(notification.emailPending, true), isNull(notification.emailedAt), isNotNull(notification.gameId)))
    .orderBy(notification.createdAt)
    .limit(50);
  let sent = 0;
  for (const r of rows) {
    // Un email de plus de 24 h n'a plus d'intérêt (« c'est votre tour » d'hier) : on le clôt sans l'envoyer. Cela évite
    // aussi une rafale d'anciens messages quand le service d'email est configuré après coup.
    if (now.getTime() - r.createdAt.getTime() > EMAIL_MAX_AGE_MS) {
      await db.update(notification).set({ emailedAt: now }).where(eq(notification.id, r.id));
      continue;
    }
    try {
      const m = renderEmail(r.type as NotificationType, { gameName: r.gameName, appUrl: env().APP_URL, gameId: r.gameId! });
      await mailer.send({ to: r.email, ...m });
      await db.update(notification).set({ emailedAt: now }).where(eq(notification.id, r.id));
      sent++;
    } catch (err) {
      console.error("[email-outbox] échec d'envoi, nouvel essai au prochain passage", err);
    }
  }
  return sent;
}
