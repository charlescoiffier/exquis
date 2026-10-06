import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { game, notification } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { Mailer } from "@/lib/notifications/mailer";
import { renderEmail } from "@/lib/notifications/render";
import type { NotificationType } from "./notifications";

export async function flushNotifications(db: Db, mailer: Mailer, now = new Date()): Promise<number> {
  const rows = await db
    .select({ id: notification.id, type: notification.type, gameId: notification.gameId, email: user.email, gameName: game.name })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .innerJoin(game, eq(game.id, notification.gameId))
    .where(and(eq(notification.emailPending, true), isNull(notification.emailedAt)))
    .orderBy(notification.createdAt)
    .limit(50);
  let sent = 0;
  for (const r of rows) {
    try {
      const m = renderEmail(r.type as NotificationType, { gameName: r.gameName, appUrl: env().APP_URL, gameId: r.gameId });
      await mailer.send({ to: r.email, ...m });
      await db.update(notification).set({ emailedAt: now }).where(eq(notification.id, r.id));
      sent++;
    } catch (err) {
      console.error("[email-outbox] échec d'envoi, nouvel essai au prochain passage", err);
    }
  }
  return sent;
}
